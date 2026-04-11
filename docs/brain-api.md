# Brain API (preferred)

Use **`/brain/*`** for the Obsidian-style vault (markdown entries under `entries/`, index in frontmatter).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/brain` | HTML UI (`renderBrainUi`) |
| GET | `/brain/status` | Vault path, entry count |
| GET | `/brain/entries?limit=` | Recent entries (metadata) |
| POST | `/brain/init` | Initialize vault on disk |
| POST | `/brain/compress-preview` | LLM compress (prompt from `prompts/brain-compression-append.md`). JSON response: `{ content, model }` (`model` = active `SPARK_MODEL`). |
| POST | `/brain/save` | Optional: `originalSource`, `userNotes`, `aiModel` — stored as clear markdown sections + `ai_model` in frontmatter when set. |
| POST | `/brain/classify` | Metadata only (title, type, themenpfad, parent, related) |
| POST | `/brain/save` | Append one markdown file (body = stored content, trim edges only) |

## Legacy alias

`/vault/status`, `/vault/init`, `/vault/capture` call the same storage. Prefer **`/brain/*`** in new clients (desktop overlay, scripts).
