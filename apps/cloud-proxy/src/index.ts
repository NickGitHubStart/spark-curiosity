/**
 * Spark Cloud Proxy — Cloudflare Worker
 *
 * Transparent OpenAI-compatible proxy that:
 * 1. Validates installation tokens (stored in KV)
 * 2. Routes chat/completions to Cloudflare Workers AI (via AI binding)
 * 3. Routes audio/transcriptions to OpenAI Whisper
 *
 * The Spark companion sends requests here exactly like it would to OpenAI —
 * same endpoints, same format. Only the URL and "API key" (= install token) differ.
 */

interface Env {
  TOKENS: KVNamespace;
  AI: Ai;
  OPENAI_API_KEY: string;
  REGISTER_SECRET?: string;
}

const OPENAI_DEFAULT_BASE = "https://api.openai.com";
const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function validateToken(env: Env, token: string): Promise<boolean> {
  if (!token) return false;
  const record = await env.TOKENS.get(token);
  if (!record) return false;
  // Update last-used timestamp (fire-and-forget, don't block the request)
  void env.TOKENS.put(
    token,
    JSON.stringify({ ...JSON.parse(record), lastUsedAt: new Date().toISOString() }),
  );
  return true;
}

function extractToken(request: Request): string {
  const auth = request.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return "";
}

// ── /register — issue a new installation token ──

async function handleRegister(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  // Optional: require a shared secret so random bots can't register tokens
  if (env.REGISTER_SECRET) {
    let body: { secret?: string } = {};
    try { body = await request.json() as { secret?: string }; } catch { /* empty */ }
    if (body.secret !== env.REGISTER_SECRET) {
      return jsonResponse({ error: "invalid_secret" }, 403);
    }
  }

  const token = generateToken();
  const record = { createdAt: new Date().toISOString(), lastUsedAt: null };
  await env.TOKENS.put(token, JSON.stringify(record));
  return jsonResponse({ token });
}

// ── OpenAI proxy (for STT) ──

async function proxyTo(
  request: Request,
  apiKey: string,
  baseUrl: string,
  path: string,
): Promise<Response> {
  const targetUrl = `${baseUrl.replace(/\/+$/, "")}${path}`;

  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${apiKey}`);
  headers.delete("host");

  const upstream = await fetch(targetUrl, {
    method: request.method,
    headers,
    body: request.body,
  });

  const responseHeaders = new Headers(upstream.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    responseHeaders.set(k, v);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

// ── Cloudflare Workers AI via binding ──

interface ChatMessage { role: string; content: string }
interface ChatRequest { model?: string; messages?: ChatMessage[]; temperature?: number; max_tokens?: number }

async function handleChatViaAiBinding(
  request: Request,
  env: Env,
): Promise<Response> {
  let body: ChatRequest;
  try {
    body = await request.json() as ChatRequest;
  } catch (e) {
    return jsonResponse({ error: "invalid_json", detail: String(e) }, 400);
  }

  const model = body.model || "@cf/zai-org/glm-4.7-flash";
  const messages = body.messages || [];

  let result: AiTextGenerationOutput;
  try {
    result = await env.AI.run(model as BaseAiTextGenerationModels, {
      messages: messages as RoleScopedChatInput[],
      temperature: body.temperature ?? 0.3,
      max_tokens: body.max_tokens ?? 8192,
    }) as AiTextGenerationOutput;
  } catch (e) {
    console.error("[spark:proxy] AI.run failed:", model, String(e));
    return jsonResponse({
      error: "ai_binding_error",
      detail: String(e),
      model,
    }, 502);
  }

  // Extract content from Workers AI response — models return different formats:
  // - Standard Workers AI: { response: string }
  // - OpenAI-compatible (Kimi, etc.): { choices: [{ message: { content, reasoning_content } }] }
  // - Reasoning models (Kimi K2.5): content may be null, actual text in reasoning_content
  let content = "";
  if (typeof result === "string") {
    content = result;
  } else if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if ("choices" in r && Array.isArray(r.choices) && r.choices.length > 0) {
      const msg = (r.choices[0] as Record<string, unknown>)?.message as Record<string, unknown> | undefined;
      content = (msg?.content as string) || (msg?.reasoning_content as string) || "";
    } else if ("response" in r && typeof r.response === "string") {
      content = r.response;
    } else {
      content = JSON.stringify(result);
    }
  }

  const openAiResponse = {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: "assistant", content },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };

  return jsonResponse(openAiResponse);
}

async function handleProxy(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const token = extractToken(request);
  if (!(await validateToken(env, token))) {
    return jsonResponse({ error: "invalid_or_missing_token" }, 401);
  }

  // Route STT (audio/transcriptions) to OpenAI Whisper
  if (path === "/v1/audio/transcriptions") {
    return proxyTo(request, env.OPENAI_API_KEY, OPENAI_DEFAULT_BASE, path);
  }

  // Route chat/completions via Cloudflare Workers AI binding
  if (path === "/v1/chat/completions") {
    return handleChatViaAiBinding(request, env);
  }

  return jsonResponse({ error: "not_found" }, 404);
}

// ── Router ──

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === "/register") {
      return handleRegister(request, env);
    }

    if (url.pathname === "/health") {
      return jsonResponse({ ok: true });
    }

    // Proxy all /v1/* paths
    if (url.pathname.startsWith("/v1/")) {
      return handleProxy(request, env, url.pathname);
    }

    return jsonResponse({ error: "not_found" }, 404);
  },
};
