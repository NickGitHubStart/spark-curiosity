import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const companionTemplates = path.resolve(__dirname, "../../companion/data/templates");

function esc(s) {
  return String(s).replace(/'/g, "''");
}

function parseTemplateFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  let body = raw;
  const meta = {};
  if (fmMatch) {
    body = fmMatch[2].trim();
    for (const line of fmMatch[1].split(/\r?\n/)) {
      const m = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
      if (m) meta[m[1].toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  const id = meta.id || path.basename(filePath, ".md");
  const highlights = (meta.highlights || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(";");
  return {
    id,
    name: meta.name || id,
    description: meta.description || "",
    highlights,
    body,
  };
}

const files = fs.readdirSync(companionTemplates).filter((f) => f.endsWith(".md"));
const rows = files.map((f) => parseTemplateFile(path.join(companionTemplates, f)));

let sql =
  "-- Auto-generated from companion/data/templates — run against D1 to sync with Windows companion.\n";
sql +=
  "DELETE FROM onboarding_templates WHERE id IN ('focus_strict','focus_balanced','focus_light'," +
  rows.map((r) => `'${r.id}'`).join(",") +
  ");\n";
for (const r of rows) {
  sql +=
    `INSERT INTO onboarding_templates (id, name, description, highlights, body) VALUES ` +
    `('${esc(r.id)}', '${esc(r.name)}', '${esc(r.description)}', '${esc(r.highlights)}', '${esc(r.body)}');\n`;
}

const out = path.resolve(__dirname, "../seed-onboarding-from-companion.sql");
fs.writeFileSync(out, sql, "utf8");
console.log("Wrote", out, rows.length, "templates");
