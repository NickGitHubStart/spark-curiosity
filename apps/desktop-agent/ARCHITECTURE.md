# Desktop Agent Architecture

## Goal
Run Spark system-wide (not browser-only) while keeping Companion contract stable.

## Layers

1. `domain/`
- Pure mapping logic from active window context to `EventIngest`.
- No side effects.

2. `providers/`
- OS-specific active-window collection:
  - `linux.ts` (`xdotool`)
  - `macos.ts` (`osascript`)
  - `windows.ts` (PowerShell)
- Exposed through `providers/index.ts`.

3. `services/`
- `companion-client.ts`: HTTP client for Companion.
- `url-opener.ts`: executes redirect URL via OS default opener.

4. `agent/`
- `redirect-tracker.ts`: return-after-redirect state machine.
- `desktop-agent.ts`: orchestration loop (poll -> map -> send -> act).

5. `index.ts`
- Bootstrap/wiring only.

## Runtime Loop
1. Read active window (provider)
2. Build `EventIngest` (domain)
3. Send to Companion (service)
4. Execute redirect action (service)
5. Track return-after-redirect (agent state)

## Next Steps (planned)
1. Add desktop-agent tests for domain mapping and redirect tracker.
2. Add privacy filters/redaction layer before sending events.
3. Add platform packaging/installers (Windows first, then macOS, then Linux).
