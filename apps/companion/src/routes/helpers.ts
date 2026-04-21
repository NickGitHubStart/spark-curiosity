import type { IncomingMessage, ServerResponse } from "node:http";

export function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(payload));
}

export function html(res: ServerResponse, payload: string): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(payload);
}

export async function parseBody<T>(req: IncomingMessage): Promise<T> {
  let body = "";
  for await (const chunk of req) body += String(chunk);
  return JSON.parse(body) as T;
}

export function paginatedJson(res: ServerResponse, data: unknown[], key: string, url: URL): void {
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 20)));
  json(res, 200, { [key]: data.slice(-limit).reverse() });
}

export function isLoopbackRequest(req: IncomingMessage): boolean {
  const a = req.socket?.remoteAddress ?? "";
  return a === "127.0.0.1" || a === "::1" || a.endsWith("127.0.0.1");
}

export type RouteHandler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean>;
