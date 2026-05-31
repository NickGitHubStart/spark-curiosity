# Security

## Reporting a vulnerability

If you find a security issue, please **do not** open a public GitHub issue with exploit details.

Instead, open a [GitHub Security Advisory](https://github.com/NickGitHubStart/spark-curiosity/security/advisories/new) or contact the maintainers privately.

## Secrets and local data

Never commit:

- `.env` or `runtime.env` with API keys
- `apps/android/app/google-services.json`
- `apps/android/firebase-app-distribution-sa.json`
- `apps/android/*.jks` / `keystore.properties`
- User memory files under `apps/companion/data/` (see `.gitignore`)

The companion stores user memory and tokens locally under `%LOCALAPPDATA%\SparkCuriosity\` on Windows. Treat that directory as sensitive on shared machines.

## Cloud proxy

Production deployments use Cloudflare Worker secrets (`XAI_API_KEY`, `OPENAI_API_KEY`, optional `SPARK_CLOUD_REGISTER_SECRET`). Set these with `wrangler secret put`, never in `wrangler.toml`.
