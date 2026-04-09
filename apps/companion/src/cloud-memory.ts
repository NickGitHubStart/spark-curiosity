/**
 * Client-side AES-GCM encrypted memory sync against the Cloudflare Worker.
 *
 * The Worker only ever sees ciphertext. The 256-bit key is generated locally
 * and stored next to user-memory.md as `memory.key` (base64). To pair another
 * device, the user transfers token + key via QR (handled in the Android app)
 * or by copying the key file directly.
 *
 * This module deliberately keeps the legacy local user-memory.md as the
 * source of truth on disk; cloud sync is additive. On first run with both a
 * cloud token and a local memory file, we encrypt + push so the cloud has a
 * copy. On subsequent reads we prefer the cloud body if it's newer.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomBytes, webcrypto } from "node:crypto";
import { DATA_DIR, MEMORY_MD_PATH, CLOUD_PROXY_URL } from "./config.js";
import { formatMemoryFile, parseMemoryFileRaw } from "./memory.js";

const KEY_PATH = join(DATA_DIR, "memory.key");
const MIGRATION_MARKER = join(DATA_DIR, ".cloud-migrated");

function b64encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
function b64decode(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}

/** Get the local AES-256 key, generating + persisting one if missing. */
export function getOrCreateMemoryKey(): Uint8Array {
  if (existsSync(KEY_PATH)) {
    return b64decode(readFileSync(KEY_PATH, "utf8").trim());
  }
  const bytes = new Uint8Array(randomBytes(32));
  writeFileSync(KEY_PATH, b64encode(bytes), { mode: 0o600 });
  return bytes;
}

/** Replace the local key (used after pairing imports a key from another device). */
export function setMemoryKey(keyBytes: Uint8Array): void {
  if (keyBytes.length !== 32) throw new Error("key must be 32 bytes");
  writeFileSync(KEY_PATH, b64encode(keyBytes), { mode: 0o600 });
}

export function hasMemoryKey(): boolean {
  return existsSync(KEY_PATH);
}

export interface Encrypted { ciphertextB64: string; nonceB64: string; }

export async function encryptMemory(plaintext: string): Promise<Encrypted> {
  const key = getOrCreateMemoryKey();
  const nonce = new Uint8Array(randomBytes(12));
  const cryptoKey = await webcrypto.subtle.importKey(
    "raw", key, { name: "AES-GCM" }, false, ["encrypt"]
  );
  const ct = await webcrypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    cryptoKey,
    new TextEncoder().encode(plaintext)
  );
  return { ciphertextB64: b64encode(new Uint8Array(ct)), nonceB64: b64encode(nonce) };
}

export async function decryptMemory(ciphertextB64: string, nonceB64: string): Promise<string> {
  const key = getOrCreateMemoryKey();
  const cryptoKey = await webcrypto.subtle.importKey(
    "raw", key, { name: "AES-GCM" }, false, ["decrypt"]
  );
  const pt = await webcrypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64decode(nonceB64) },
    cryptoKey,
    b64decode(ciphertextB64)
  );
  return new TextDecoder().decode(pt);
}

interface EncryptedMemoryResponse {
  exists: boolean;
  encryptedBody?: string;
  nonce?: string;
  cipherVersion?: number;
  onboardingComplete?: boolean;
  updatedAt?: string;
}

function authHeaders(token: string): Record<string, string> {
  return { "authorization": `Bearer ${token}`, "content-type": "application/json" };
}

export async function fetchEncryptedMemory(token: string): Promise<{
  body: string; onboardingComplete: boolean; updatedAt: string | null;
} | null> {
  if (!CLOUD_PROXY_URL) return null;
  const res = await fetch(`${CLOUD_PROXY_URL.replace(/\/+$/, "")}/memory/encrypted`, {
    method: "GET",
    headers: authHeaders(token),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const data = await res.json() as EncryptedMemoryResponse;
  if (!data.exists || !data.encryptedBody || !data.nonce) return null;
  try {
    const body = await decryptMemory(data.encryptedBody, data.nonce);
    return {
      body,
      onboardingComplete: !!data.onboardingComplete,
      updatedAt: data.updatedAt || null,
    };
  } catch {
    // Wrong key (e.g. user pairing mismatch) — caller decides what to do.
    return null;
  }
}

export async function pushEncryptedMemory(
  token: string, body: string, onboardingComplete: boolean
): Promise<boolean> {
  if (!CLOUD_PROXY_URL) return false;
  const enc = await encryptMemory(body);
  const res = await fetch(`${CLOUD_PROXY_URL.replace(/\/+$/, "")}/memory/encrypted`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      encryptedBody: enc.ciphertextB64,
      nonce: enc.nonceB64,
      onboardingComplete,
      cipherVersion: 1,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  return res.ok;
}

/**
 * One-shot migration: if we have a token + local memory file but no marker,
 * encrypt the local body and push it to the cloud, then write the marker.
 * Safe to call repeatedly — does nothing after first success.
 */
export async function migrateLocalMemoryToCloud(token: string): Promise<{
  ok: boolean; reason?: string;
}> {
  if (!CLOUD_PROXY_URL) return { ok: false, reason: "no_proxy" };
  if (existsSync(MIGRATION_MARKER)) return { ok: true, reason: "already_migrated" };
  if (!existsSync(MEMORY_MD_PATH)) return { ok: false, reason: "no_local_memory" };
  try {
    const raw = readFileSync(MEMORY_MD_PATH, "utf8");
    const parsed = parseMemoryFileRaw(raw);
    const body = parsed.body || "";
    const onboardingComplete = parsed.onboardingComplete ?? false;
    const ok = await pushEncryptedMemory(token, body, onboardingComplete);
    if (ok) {
      writeFileSync(MIGRATION_MARKER, new Date().toISOString());
      return { ok: true };
    }
    return { ok: false, reason: "push_failed" };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

/**
 * Pull the latest cloud body and overlay it on top of the local file.
 * Used after pairing — local file gets overwritten with the body the other
 * device has stored. No-op if cloud has no entry.
 */
export async function pullCloudMemoryToLocal(token: string): Promise<boolean> {
  const remote = await fetchEncryptedMemory(token);
  if (!remote) return false;
  try {
    writeFileSync(MEMORY_MD_PATH, formatMemoryFile(remote.body, remote.onboardingComplete), "utf8");
    writeFileSync(MIGRATION_MARKER, new Date().toISOString());
    return true;
  } catch {
    return false;
  }
}

export const CLOUD_MEMORY_KEY_PATH = KEY_PATH;
