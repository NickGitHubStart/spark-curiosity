# Companion Prompts

**Das LLM bekommt seinen System-Prompt aus genau einer Datei:**

- **`agent-system-prompt.md`** (in diesem Ordner)

---

## Wo wird der Agent aufgerufen? (alles in `apps/companion/src/index.ts`)

| Was | Zeile | Code |
|-----|-------|------|
| **Konfiguration** (Model, Ollama-URL, Prompt-Pfad) | 10–21 | `HOST`, `PORT`, `PROVIDER`, `MODEL`, `OLLAMA_BASE_URL`, `PROMPT_DIR`, `SYSTEM_PROMPT_PATH` |
| **System-Prompt laden** | 121–127 | `loadSystemPrompt()` liest `SYSTEM_PROMPT_PATH` ( = diese `agent-system-prompt.md`) |
| **LLM aufrufen** | 277–291 | `callOllama(prompt, system)` → `fetch(OLLAMA_BASE_URL/api/generate`, Body: `{ model, prompt, system, stream: false }`) |
| **Agent für Event-Entscheidung** | 327, 359 | `const system = loadSystemPrompt();` → … → `callOllama(prompt, system)` |
| **Agent für Chat** | 496, 504 | `const system = loadSystemPrompt();` → … → `callOllama(prompt, system)` |

Du siehst also: **Der Inhalt von `agent-system-prompt.md` wird bei jedem Aufruf gelesen und als `system` an Ollama geschickt.** Das ist der System-Prompt, den das LLM wirklich erhält.

---

## Wo sind die Details eingestellt?

In **`apps/companion/src/index.ts`** oben (Zeilen 10–21):

- **`SPARK_COMPANION_HOST`** / **`SPARK_COMPANION_PORT`** – wohin der Companion lauscht (Default 0.0.0.0:4343)
- **`SPARK_AI_PROVIDER`** – `"none"` | `"local"` (aktuell wird der Agent immer aufgerufen; Provider nur für Stats)
- **`SPARK_LOCAL_LLM_MODEL`** – Modellname für Ollama (Default `phi3:mini`)
- **`SPARK_OLLAMA_BASE_URL`** – Ollama-API (Default `http://127.0.0.1:11434`)
- **`SPARK_PROMPT_DIR`** – Ordner für Prompts (Default `process.cwd()/apps/companion/prompts`)
- **`SYSTEM_PROMPT_PATH`** – `PROMPT_DIR + "agent-system-prompt.md"` → **genau diese Datei**

---

## Warum siehst du die Datei „zweimal“?

- `apps/companion/prompts/agent-system-prompt.md` → die echte Datei
- `node_modules/@spark/companion/prompts/agent-system-prompt.md` → dieselbe Datei (Workspace-Symlink)

Es gibt nur **eine** Datei; bearbeite **`apps/companion/prompts/agent-system-prompt.md`**.
