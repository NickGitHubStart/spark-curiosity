/**
 * Companion route handler — wires all cloud companion endpoints.
 * Each endpoint mirrors the desktop companion's HTTP API but uses D1 instead of filesystem.
 */

import type { Env, EventIngest, ChatRequest } from "./types.js";
import { decide } from "./decision.js";
import { runAiChat } from "./ai.js";
import {
  readMemory, writeMemory, ensureUser, applyMemoryOps,
  getOnboardingStatus, applyTemplate, listTemplates, buildWelcome
} from "./d1-memory.js";
import { readCuratedGate, applyCuratedGateUpdate, type CuratedGateUpdate } from "./d1-curated-gate.js";
import { readEncryptedMemory, writeEncryptedMemory } from "./d1-memory-encrypted.js";
import { getStats, recordBlockEvent } from "./stats.js";
import { writePlatformContext, readPlatformContext } from "./d1-platform-context.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
    },
  });
}

function extractToken(request: Request): string {
  const auth = request.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return "";
}

async function validateToken(env: Env, token: string): Promise<boolean> {
  if (!token) return false;
  const record = await env.TOKENS.get(token);
  if (!record) return false;
  void env.TOKENS.put(
    token,
    JSON.stringify({ ...JSON.parse(record), lastUsedAt: new Date().toISOString() }),
  );
  return true;
}

// ── Route handlers ──

async function handleEvent(request: Request, env: Env, token: string): Promise<Response> {
  const payload = await request.json() as EventIngest & {
    memory?: { body: string; onboardingComplete: boolean };
  };
  if (!payload.url || !payload.platform) return json({ error: "missing_fields" }, 400);
  await ensureUser(env.DB, token);
  const { memory, ...event } = payload;
  const result = await decide(event as EventIngest, token, env, memory);
  return json(result);
}

async function handleChat(request: Request, env: Env, token: string): Promise<Response> {
  const payload = await request.json() as ChatRequest & {
    memory?: { body: string; onboardingComplete: boolean };
  };
  const { message, memory: inlineMemory } = payload;
  if (!message?.trim()) return json({ error: "empty_message" }, 400);

  await ensureUser(env.DB, token);
  const useInline = inlineMemory != null;
  const { body: memoryBody, onboardingComplete } = useInline
    ? inlineMemory!
    : await readMemory(env.DB, token);
  const aiResult = await runAiChat(message, memoryBody, env, token);

  // Apply memory ops from AI response
  let updatedBody = memoryBody;
  if (aiResult.memoryOps?.length) {
    updatedBody = applyMemoryOps(memoryBody, aiResult.memoryOps);
  }

  // Apply curated gate tool calls if present
  if (aiResult.toolCalls?.length) {
    for (const call of aiResult.toolCalls) {
      if (call.tool === "set_curated_gate") {
        const args = call.args as { mode?: string; rules?: unknown[]; ruleIds?: string[]; note?: string };
        const validModes = ["set", "add", "remove", "disable"] as const;
        if (args?.mode && (validModes as readonly string[]).includes(args.mode)) {
          await applyCuratedGateUpdate(env.DB, token, {
            mode: args.mode as CuratedGateUpdate["mode"],
            rules: Array.isArray(args.rules) ? args.rules as CuratedGateUpdate["rules"] : undefined,
            ruleIds: args.ruleIds,
            note: typeof args.note === "string" ? args.note : undefined
          });
        }
      }
    }
  }

  // Always write plaintext so Windows + Android stay in sync.
  const memoryChanged = updatedBody !== memoryBody;
  if (memoryChanged) {
    await writeMemory(env.DB, token, updatedBody, onboardingComplete);
  }

  return json({
    reply: aiResult.reply,
    memoryUpdated: memoryChanged,
    openUrl: aiResult.openUrl,
    // Inline-mode clients re-encrypt + persist this themselves.
    updatedMemoryBody: useInline && memoryChanged ? updatedBody : undefined,
  });
}

async function handleMemoryRead(env: Env, token: string): Promise<Response> {
  await ensureUser(env.DB, token);
  const { body, onboardingComplete, lang } = await readMemory(env.DB, token);
  return json({ body, onboardingComplete, lang });
}

async function handleMemoryWrite(request: Request, env: Env, token: string): Promise<Response> {
  const { body, onboardingComplete } = await request.json() as { body: string; onboardingComplete: boolean };
  if (typeof body !== "string") return json({ error: "missing_body" }, 400);
  await writeMemory(env.DB, token, body, Boolean(onboardingComplete));
  return json({ ok: true });
}

async function handleOverlayInit(env: Env, token: string): Promise<Response> {
  await ensureUser(env.DB, token);
  const { body, onboardingComplete } = await readMemory(env.DB, token);
  const policy = await readCuratedGate(env.DB, token);
  const welcome = onboardingComplete ? buildWelcome(body) : null;
  return json({
    onboardingComplete,
    curatedGatePolicy: policy,
    welcome,
    lang: "de"
  });
}

async function handleOnboardingStatus(env: Env, token: string): Promise<Response> {
  const complete = await getOnboardingStatus(env.DB, token);
  return json({ onboardingComplete: complete });
}

async function handleOnboardingTemplates(env: Env): Promise<Response> {
  const templates = await listTemplates(env.DB);
  return json({ templates });
}

async function handleOnboardingApply(request: Request, env: Env, token: string): Promise<Response> {
  const { templateId, customNotes } = await request.json() as { templateId: string; customNotes?: string };
  if (!templateId) return json({ error: "missing_template_id" }, 400);
  await ensureUser(env.DB, token);
  const result = await applyTemplate(env.DB, token, templateId, customNotes);
  return json(result);
}

async function handleOnboardingComplete(request: Request, env: Env, token: string): Promise<Response> {
  const { wishes, name } = await request.json() as { wishes?: string; name?: string };
  await ensureUser(env.DB, token);
  const { body } = await readMemory(env.DB, token);
  let updatedBody = body;
  const ops = [];
  if (name?.trim()) {
    ops.push({ op: "add" as const, section: "Long-Term" as const, entry: `Name: ${name.trim()}` });
  }
  if (wishes?.trim()) {
    ops.push({ op: "add" as const, section: "Long-Term" as const, entry: wishes.trim() });
  }
  if (ops.length) {
    updatedBody = applyMemoryOps(updatedBody, ops);
  }
  await writeMemory(env.DB, token, updatedBody, true);
  const welcome = buildWelcome(updatedBody);
  return json({ ok: true, welcome });
}

async function handleEncryptedMemoryRead(env: Env, token: string): Promise<Response> {
  const row = await readEncryptedMemory(env.DB, token);
  if (!row) return json({ exists: false });
  return json({ exists: true, ...row });
}

async function handleEncryptedMemoryWrite(request: Request, env: Env, token: string): Promise<Response> {
  let body: { encryptedBody?: string; nonce?: string; onboardingComplete?: boolean; cipherVersion?: number };
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
  if (!body.encryptedBody || !body.nonce) return json({ error: "missing_ciphertext" }, 400);
  await writeEncryptedMemory(
    env.DB,
    token,
    body.encryptedBody,
    body.nonce,
    Boolean(body.onboardingComplete),
    body.cipherVersion ?? 1,
  );
  return json({ ok: true });
}

async function handleStats(env: Env, token: string, range: string): Promise<Response> {
  const stats = await getStats(env.DB, token, range);
  return json(stats);
}

async function handleCuratedGateRead(env: Env, token: string): Promise<Response> {
  const policy = await readCuratedGate(env.DB, token);
  return json(policy);
}

async function handleCuratedGateUpdate(request: Request, env: Env, token: string): Promise<Response> {
  const update = await request.json() as CuratedGateUpdate;
  const policy = await applyCuratedGateUpdate(env.DB, token, update);
  return json(policy);
}

async function handleContextWrite(request: Request, env: Env, token: string): Promise<Response> {
  const { platform, summary, url } = await request.json() as { platform?: string; summary?: string; url?: string };
  if (platform !== "pc" && platform !== "android") return json({ error: "platform must be 'pc' or 'android'" }, 400);
  if (!summary?.trim()) return json({ error: "summary required" }, 400);
  await writePlatformContext(env.DB, token, platform, summary.trim(), url);
  return json({ ok: true });
}

async function handleContextRead(request: Request, env: Env, token: string): Promise<Response> {
  const url = new URL(request.url);
  const platform = url.searchParams.get("platform") as "pc" | "android" | null;
  if (platform !== "pc" && platform !== "android") return json({ error: "platform must be 'pc' or 'android'" }, 400);
  const ctx = await readPlatformContext(env.DB, token, platform);
  if (!ctx) return json({ exists: false });
  return json({ exists: true, ...ctx });
}

async function handleBugReport(request: Request, env: Env, token: string): Promise<Response> {
  const { message, context } = await request.json() as { message: string; context?: string };
  if (!message?.trim()) return json({ error: "empty_message" }, 400);
  await env.DB.prepare(`
    INSERT INTO bug_reports (token, description, context, created_at)
    VALUES (?, ?, ?, datetime('now'))
  `).bind(token, message.trim(), context || null).run();
  return json({ ok: true });
}

// ── Main router ──

export async function handleCompanionRoute(
  request: Request, env: Env, path: string
): Promise<Response | null> {
  // All companion routes require auth
  const token = extractToken(request);
  if (!token || !(await validateToken(env, token))) {
    // Return null for non-companion paths (let the caller handle 404)
    if (!isCompanionPath(path)) return null;
    return json({ error: "invalid_or_missing_token" }, 401);
  }

  // POST endpoints
  if (request.method === "POST") {
    if (path === "/event") return handleEvent(request, env, token);
    if (path === "/chat") return handleChat(request, env, token);
    if (path === "/memory") return handleMemoryWrite(request, env, token);
    if (path === "/memory/encrypted") return handleEncryptedMemoryWrite(request, env, token);
    if (path === "/onboarding/apply") return handleOnboardingApply(request, env, token);
    if (path === "/onboarding/complete") return handleOnboardingComplete(request, env, token);
    if (path === "/curated-gate") return handleCuratedGateUpdate(request, env, token);
    if (path === "/bug-report") return handleBugReport(request, env, token);
    if (path === "/context") return handleContextWrite(request, env, token);
  }

  // GET endpoints
  if (request.method === "GET") {
    if (path === "/overlay/init") return handleOverlayInit(env, token);
    if (path === "/memory") return handleMemoryRead(env, token);
    if (path === "/memory/encrypted") return handleEncryptedMemoryRead(env, token);
    if (path === "/onboarding/status") return handleOnboardingStatus(env, token);
    if (path === "/onboarding/templates") return handleOnboardingTemplates(env);
    if (path === "/curated-gate") return handleCuratedGateRead(env, token);
    if (path === "/context") return handleContextRead(request, env, token);
    if (path.startsWith("/stats")) {
      const url = new URL(request.url);
      const range = url.searchParams.get("range") || "today";
      return handleStats(env, token, range);
    }
  }

  return null; // not a companion route
}

function isCompanionPath(path: string): boolean {
  const prefixes = ["/event", "/chat", "/memory", "/overlay", "/onboarding", "/stats", "/curated-gate", "/bug-report", "/context"];
  return prefixes.some(p => path === p || path.startsWith(p + "/"));
}
