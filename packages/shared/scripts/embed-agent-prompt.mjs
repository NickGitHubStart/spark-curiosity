/**
 * Reads prompts/agent-system-prompt.md and emits src/generated/agent-system-prompt.ts
 * so Companion + Cloud-Proxy can import the same string from @spark/shared.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, "..");
const mdPath = join(pkgRoot, "prompts", "agent-system-prompt.md");
const outPath = join(pkgRoot, "src", "generated", "agent-system-prompt.ts");

const text = readFileSync(mdPath, "utf8");

function escapeForTemplateLiteral(s) {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");
}

const body = `/**
 * AUTO-GENERATED from prompts/agent-system-prompt.md — edit that file, then \`npm run build\` in packages/shared.
 */
export const AGENT_SYSTEM_PROMPT = \`${escapeForTemplateLiteral(text)}\`;
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, body, "utf8");
