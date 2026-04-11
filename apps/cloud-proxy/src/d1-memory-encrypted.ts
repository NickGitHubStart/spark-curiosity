/**
 * Encrypted memory storage — opaque blob CRUD.
 *
 * The Worker never sees plaintext: clients encrypt locally with AES-GCM
 * using a key derived at first install (never sent to the server). Pairing
 * across devices transfers token + key via QR — also never via the server.
 */

export interface EncryptedMemoryRow {
  encryptedBody: string; // base64 ciphertext
  nonce: string;          // base64 12-byte GCM nonce
  cipherVersion: number;
  onboardingComplete: boolean;
  updatedAt: string | null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function readEncryptedMemory(
  db: D1Database,
  token: string,
): Promise<EncryptedMemoryRow | null> {
  const row = await db.prepare(
    `SELECT encrypted_body, nonce, cipher_version, onboarding_complete, updated_at
     FROM user_memory WHERE token = ?`,
  ).bind(token).first<{
    encrypted_body: ArrayBuffer | Uint8Array | null;
    nonce: ArrayBuffer | Uint8Array | null;
    cipher_version: number | null;
    onboarding_complete: number;
    updated_at: string | null;
  }>();

  if (!row || !row.encrypted_body || !row.nonce) return null;

  const bodyBytes = row.encrypted_body instanceof Uint8Array
    ? row.encrypted_body
    : new Uint8Array(row.encrypted_body);
  const nonceBytes = row.nonce instanceof Uint8Array
    ? row.nonce
    : new Uint8Array(row.nonce);

  return {
    encryptedBody: bytesToBase64(bodyBytes),
    nonce: bytesToBase64(nonceBytes),
    cipherVersion: row.cipher_version || 1,
    onboardingComplete: row.onboarding_complete === 1,
    updatedAt: row.updated_at,
  };
}

export async function writeEncryptedMemory(
  db: D1Database,
  token: string,
  encryptedBodyB64: string,
  nonceB64: string,
  onboardingComplete: boolean,
  cipherVersion = 1,
): Promise<void> {
  const bodyBytes = base64ToBytes(encryptedBodyB64);
  const nonceBytes = base64ToBytes(nonceB64);

  // Use COALESCE on INSERT so we never overwrite an existing plaintext body with empty.
  // The body column is the cross-platform sync source for Windows.
  const DEFAULT_BODY_FALLBACK = `## Long-Term\n- (leer)\n\n## Mid-Term\n- (leer)\n\n## Short-Term\n- (leer)`;
  await db.prepare(`
    INSERT INTO user_memory (token, body, encrypted_body, nonce, cipher_version, onboarding_complete, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(token) DO UPDATE SET
      encrypted_body = ?,
      nonce = ?,
      cipher_version = ?,
      onboarding_complete = ?,
      updated_at = datetime('now')
  `).bind(
    token,
    DEFAULT_BODY_FALLBACK,
    bodyBytes,
    nonceBytes,
    cipherVersion,
    onboardingComplete ? 1 : 0,
    bodyBytes,
    nonceBytes,
    cipherVersion,
    onboardingComplete ? 1 : 0,
  ).run();
}
