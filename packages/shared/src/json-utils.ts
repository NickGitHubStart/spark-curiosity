/**
 * Robust JSON parsing for LLM output.
 *
 * LLMs often return JSON wrapped in code fences, with trailing comments,
 * or surrounded by conversational text. This pipeline handles all of that:
 *   strip fences → strip // comments (respecting string literals) →
 *   try parse → extract first balanced {...} → try parse again.
 */

export function stripCodeFences(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z0-9_-]*\s*/u, "");
    t = t.replace(/\s*```$/u, "");
  }
  return t.trim();
}

export function stripLineCommentsOutsideStrings(text: string): string {
  let out = "";
  let inString = false;
  let escaping = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : "";
    if (escaping) { out += ch; escaping = false; continue; }
    if (ch === "\\") { out += ch; if (inString) escaping = true; continue; }
    if (ch === "\"") { out += ch; inString = !inString; continue; }
    if (!inString && ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      if (i < text.length) out += "\n";
      continue;
    }
    out += ch;
  }
  return out;
}

export function extractBalancedJson(text: string): string | null {
  let inString = false;
  let escaping = false;
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escaping) { escaping = false; continue; }
    if (ch === "\\") { if (inString) escaping = true; continue; }
    if (ch === "\"") { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") { if (depth === 0) start = i; depth += 1; continue; }
    if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function parseLooseJson(text: string): Record<string, unknown> | null {
  const normalized = stripLineCommentsOutsideStrings(stripCodeFences(text));
  try { return JSON.parse(normalized) as Record<string, unknown>; } catch { /* continue */ }
  const candidate = extractBalancedJson(normalized);
  if (!candidate) return null;
  try { return JSON.parse(candidate) as Record<string, unknown>; } catch { return null; }
}
