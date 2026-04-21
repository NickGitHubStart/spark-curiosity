# Companion Prompts

**Der Agent erhält ausschließlich:**

1. **System-Prompt:** Eine Quelle im Repo: **`packages/shared/prompts/agent-system-prompt.md`**. Beim Build von `@spark/shared` wird daraus `AGENT_SYSTEM_PROMPT` generiert; Companion und Cloud-Proxy importieren denselben String aus `@spark/shared` (`loadSystemPrompt()` in `ai.ts` liefert ihn).
2. **Memory:** Der komplette Markdown-Body von `data/user-memory.md` (wird im Prompt mitgegeben). Keine alten Nachrichten, kein Kontext außer dem aktuellen Request.
3. **Brain-Kompression (fix):** `brain-compression-append.md` — wird an den Quelltext angehängt für `POST /brain/compress-preview` (`runAiBrainCompression` in `ai.ts`). Nur bewusst ändern, nicht bei Refactors mitziehen.

**Brain-Speicherort (Vault):** Standard `DATA_DIR/Brain`. Override: `SPARK_BRAIN_PATH` oder `SPARK_OBSIDIAN_VAULT_PATH` (Legacy-Name, gleiche Bedeutung).

**HTTP:** Clients nutzen **`/brain/*`**. Die Routen **`/vault/*`** sind Legacy-Alias (gleiche Handler), keine zweite API-Oberfläche für neue Features.

**Memory-Änderungen:** Das LLM gibt **memoryOps** zurück (add/remove/update pro Section), nicht den vollen Body. Der Companion wendet die Ops auf den bestehenden Body an und erhält dabei Preambles (z. B. Definitionstexte) aus dem .md – nichts wird regelbasiert aus dem Code eingefügt.

**Relevanter Code:** `apps/companion/src/index.ts` – `readMemoryFile()`, `runAiDecision()`, `runAiChat()`, `applyMemoryOps()`.

**Konfiguration:** `SPARK_PROMPT_DIR` (nur noch für Dateien in diesem Ordner, z. B. `brain-compression-append.md`), `SPARK_AI_PROVIDER`, `SPARK_LOCAL_LLM_MODEL`, `SPARK_OLLAMA_BASE_URL`, `SPARK_GROK_*` (siehe `.env.example`).

**System-Prompt bearbeiten:** `packages/shared/prompts/agent-system-prompt.md` ändern, dann **`npm run build -w @spark/shared`** (oder Root-`build`), damit `src/generated/agent-system-prompt.ts` und `dist/` aktuell sind.
