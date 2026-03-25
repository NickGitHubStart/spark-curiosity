# LLM-Modell wechseln

## Aktueller Global Default: `grok-4-1-fast` (xAI API)

Seit Maerz 2026 nutzt Spark global **Grok 4.1 Fast** ueber die xAI API.
Alle Installationen senden Requests an den Cloud Proxy, der sie an `api.x.ai/v1` weiterleitet.
Der xAI API Key liegt serverseitig als Cloudflare Worker Secret (`XAI_API_KEY`) — nicht im Installer.

Cloudflare Workers AI (`@cf/` Modelle) ist als Fallback verfuegbar, wird aber aktuell nicht aktiv genutzt.

## Fuer Endnutzer: Model aendern (lokal)

```
%LOCALAPPDATA%\SparkCuriosity\config\runtime.env
```
Aendern: `SPARK_MODEL=grok-4-1-fast` (oder anderes Modell)

Spark neu starten. Fertig.

## Routing-Logik (Cloud Proxy)

Der Cloud Proxy routet anhand des Model-Namens:

| Model-Prefix | Routing | API Key |
|---|---|---|
| `grok-*`, `gpt-*`, etc. (alles ohne `@cf/`) | → `api.x.ai/v1/chat/completions` | Serverseitig: `XAI_API_KEY` Worker Secret |
| `@cf/...` | → Cloudflare Workers AI Binding (`env.AI.run()`) | Keiner noetig (CF Binding) |

**Wichtig:** Fuer nicht-`@cf/` Modelle muss `XAI_API_KEY` als Cloudflare Worker Secret konfiguriert sein:
```bash
npx wrangler secret put XAI_API_KEY
# xAI API Key eingeben
```

## Fuer Installer-Builds

Default in `scripts/build-dist.ps1` (Parameter `$SparkModel`):

```powershell
powershell -File scripts\build-dist.ps1 -SparkModel "grok-4-1-fast"
```

Oder `SPARK_MODEL` Env-Variable setzen. Wird in `dist-package/config/runtime.env` geschrieben.

## Zurueck zu Cloudflare Workers AI wechseln

1. `SPARK_MODEL=@cf/provider/model-name` in runtime.env
2. Cloud Proxy erkennt `@cf/` Prefix und nutzt Workers AI Binding statt xAI
3. Kein API Key noetig fuer CF Modelle

## Bekannte Besonderheiten

| Modell | Besonderheit |
|---|---|
| `grok-4-1-fast` | **Aktueller Default.** Schnell, guenstig, gute Qualitaet. Laeuft ueber xAI API via Cloud Proxy. |
| `@cf/zai-org/glm-4.7-flash` | Cloudflare Workers AI Fallback. Guenstig (Neuron-Pricing), aber weniger zuverlaessig bei Entscheidungen. |
| `@cf/moonshotai/kimi-k2.5` | Reasoning-Modell: verbraucht Tokens fuer internes Denken. `max_tokens` >= 8192. Teuer. |
| `@cf/meta/llama-*` | Standard Workers AI Format. Nicht empfohlen — zu aggressiv bei Interventionen. |
