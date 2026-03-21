/**
 * Spark Cloud Proxy — Cloudflare Worker
 *
 * Transparent OpenAI-compatible proxy that:
 * 1. Validates installation tokens (stored in KV)
 * 2. Forwards requests to xAI with the real API key
 * 3. Streams responses back to the client
 *
 * The Spark companion sends requests here exactly like it would to xAI —
 * same endpoints, same format. Only the URL and "API key" (= install token) differ.
 */

interface Env {
  TOKENS: KVNamespace;
  XAI_API_KEY: string;
  XAI_BASE_URL?: string;
  REGISTER_SECRET?: string;
}

const XAI_DEFAULT_BASE = "https://api.x.ai";
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

// ── /v1/* — transparent proxy to xAI ──

async function handleProxy(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const token = extractToken(request);
  if (!(await validateToken(env, token))) {
    return jsonResponse({ error: "invalid_or_missing_token" }, 401);
  }

  const baseUrl = (env.XAI_BASE_URL || XAI_DEFAULT_BASE).replace(/\/+$/, "");
  const targetUrl = `${baseUrl}${path}`;

  // Clone headers, replace auth with real API key
  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${env.XAI_API_KEY}`);
  headers.delete("host");

  const upstream = await fetch(targetUrl, {
    method: request.method,
    headers,
    body: request.body,
  });

  // Stream the response back transparently
  const responseHeaders = new Headers(upstream.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    responseHeaders.set(k, v);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
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
