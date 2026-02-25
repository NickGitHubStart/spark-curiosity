import { COMPANION_URL, HEARTBEAT_DEFAULT_SECONDS, POLL_MS, REDIRECT_TRACK_MS } from "./config.js";
import { DesktopAgent } from "./agent/desktop-agent.js";
import { CompanionClient } from "./services/companion-client.js";

const agent = new DesktopAgent({
  companionClient: new CompanionClient(COMPANION_URL),
  pollMs: POLL_MS,
  heartbeatDefaultSeconds: HEARTBEAT_DEFAULT_SECONDS,
  redirectTrackerMs: REDIRECT_TRACK_MS
});

process.on("SIGINT", () => { agent.stop(); });
process.on("SIGTERM", () => { agent.stop(); });

console.log(`[spark:desktop] starting desktop agent on ${process.platform}`);
console.log(`[spark:desktop] companion: ${COMPANION_URL}`);

void agent.runForever().catch(err => {
  console.error("[spark:desktop] fatal:", err);
  process.exitCode = 1;
});
