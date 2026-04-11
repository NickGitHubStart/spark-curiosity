# Companion Prompts

**Der Agent erhält ausschließlich:**

1. **System-Prompt:** `agent-system-prompt.md` (dieser Ordner), bei jedem Aufruf via `loadSystemPrompt()`.
2. **Memory:** Der komplette Markdown-Body von `data/user-memory.md` (wird im Prompt mitgegeben). Keine alten Nachrichten, kein Kontext außer dem aktuellen Request.
3. **Brain-Kompression (fix):** `brain-compression-append.md` — wird an den Quelltext angehängt für `POST /brain/compress-preview` (`runAiBrainCompression` in `ai.ts`). Nur bewusst ändern, nicht bei Refactors mitziehen.

**Brain-Speicherort (Vault):** Standard `DATA_DIR/Brain`. Override: `SPARK_BRAIN_PATH` oder `SPARK_OBSIDIAN_VAULT_PATH` (Legacy-Name, gleiche Bedeutung).

**HTTP:** Clients nutzen **`/brain/*`**. Die Routen **`/vault/*`** sind Legacy-Alias (gleiche Handler), keine zweite API-Oberfläche für neue Features.

**Memory-Änderungen:** Das LLM gibt **memoryOps** zurück (add/remove/update pro Section), nicht den vollen Body. Der Companion wendet die Ops auf den bestehenden Body an und erhält dabei Preambles (z. B. Definitionstexte) aus dem .md – nichts wird regelbasiert aus dem Code eingefügt.

**Relevanter Code:** `apps/companion/src/index.ts` – `loadSystemPrompt()`, `readMemoryFile()`, `runAiDecision()`, `runAiChat()`, `applyMemoryOps()`.

**Konfiguration:** `SPARK_PROMPT_DIR`, `SPARK_AI_PROVIDER`, `SPARK_LOCAL_LLM_MODEL`, `SPARK_OLLAMA_BASE_URL`, `SPARK_GROK_*` (siehe `.env.example`).

Bearbeite immer **`apps/companion/prompts/agent-system-prompt.md`** (nicht die Kopie unter node_modules).
