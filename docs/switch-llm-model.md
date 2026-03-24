# LLM-Modell wechseln

## Nur 1 Stelle bei Cloudflare Workers AI Modellen

Wenn das neue Modell auf Cloudflare Workers AI verfuegbar ist (Model-IDs beginnen mit `@cf/`):

```
%LOCALAPPDATA%\SparkCuriosity\config\runtime.env
```
Aendern: `SPARK_GROK_MODEL=@cf/neuer-provider/model-name`

Spark neu starten. Fertig.

Das Modell wird vom Companion an den Cloud Proxy geschickt, der es direkt an `env.AI.run()` weitergibt. Kein API-Key noetig, laeuft ueber das Cloudflare Workers AI Binding.

## Fuer neue Installer-Builds (alle Stellen)

Wenn der Default fuer neue Installationen geaendert werden soll:

| Datei | Zeile |
|---|---|
| `dist-package/config/runtime.env` | `SPARK_GROK_MODEL=...` |
| `scripts/build-dist.ps1` | `SPARK_GROK_MODEL=...` (im envLines Array) |
| `scripts/windows/install-runtime.ps1` | Default-Wert im else-Block |
| `apps/cloud-proxy/src/index.ts` | Fallback-Default in `handleChatViaAiBinding` |

Nach Aenderung von `cloud-proxy/src/index.ts`: `cd apps/cloud-proxy && npx wrangler deploy`

## Externer API-Provider (xAI, OpenAI, etc.)

Anderer Pfad: braucht API-Key + HTTP-Proxy statt AI Binding. Cloud Proxy muss umgebaut werden:
- `handleChatViaAiBinding()` -> HTTP-Weiterleitung an externe Base-URL
- API-Key als Cloudflare Worker Secret konfigurieren

## Bekannte Besonderheiten

| Modell | Besonderheit |
|---|---|
| `@cf/moonshotai/kimi-k2.5` | Reasoning-Modell: verbraucht Tokens fuer internes Denken bevor es antwortet. `max_tokens` muss hoch genug sein (>=8192). Antwort kann in `reasoning_content` statt `content` stehen. |
| `@cf/meta/llama-*` | Standard Workers AI Format (`{ response: string }`). Kein Reasoning-Overhead. |
