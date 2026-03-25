# LLM-Modell wechseln

## Nur 1 Stelle bei Cloudflare Workers AI Modellen

Wenn das neue Modell auf Cloudflare Workers AI verfuegbar ist (Model-IDs beginnen mit `@cf/`):

```
%LOCALAPPDATA%\SparkCuriosity\config\runtime.env
```
Aendern: `SPARK_MODEL=@cf/neuer-provider/model-name`

Spark neu starten. Fertig.

Das Modell wird vom Companion an den Cloud Proxy geschickt, der es direkt an `env.AI.run()` weitergibt. Kein API-Key noetig, laeuft ueber das Cloudflare Workers AI Binding.

## Fuer neue Installer-Builds

Nur 1 Stelle aendern — der Default in `scripts/build-dist.ps1` (Parameter `$SparkModel`):

```powershell
powershell -File scripts\build-dist.ps1 -SparkModel "@cf/neuer-provider/model-name"
```

Oder die Env-Variable `SPARK_MODEL` setzen bevor man baut. Das wird automatisch in `dist-package/config/runtime.env` geschrieben, und der Installer uebernimmt es bei Updates.

Cloud Proxy bekommt das Modell vom Companion (kein Hardcode noetig). Fallback in `apps/cloud-proxy/src/index.ts` nur fuer den Edge Case dass kein Modell mitgesendet wird.

## Externer API-Provider (xAI, OpenAI, etc.)

Anderer Pfad: braucht API-Key + HTTP-Proxy statt AI Binding. Cloud Proxy muss umgebaut werden:
- `handleChatViaAiBinding()` -> HTTP-Weiterleitung an externe Base-URL
- API-Key als Cloudflare Worker Secret konfigurieren

## Bekannte Besonderheiten

| Modell | Besonderheit |
|---|---|
| `@cf/moonshotai/kimi-k2.5` | Reasoning-Modell: verbraucht Tokens fuer internes Denken bevor es antwortet. `max_tokens` muss hoch genug sein (>=8192). Antwort kann in `reasoning_content` statt `content` stehen. |
| `@cf/meta/llama-*` | Standard Workers AI Format (`{ response: string }`). Kein Reasoning-Overhead. |
