import type { EventDecisionResponse, EventIngest } from "@spark/shared";
import { contextKeyFromEvent, buildEvent } from "../domain/context.js";
import { getActiveWindow } from "../providers/index.js";
import { CompanionClient } from "../services/companion-client.js";
import { openExternalUrl } from "../services/url-opener.js";
import { RedirectTrackerStore } from "./redirect-tracker.js";

type DesktopAgentDeps = {
  companionClient: CompanionClient;
  pollMs: number;
  heartbeatDefaultSeconds: number;
  redirectTrackerMs: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function shouldImmediateRedirect(decision: EventDecisionResponse): string | null {
  const action = decision.action;
  if (action?.type === "redirect" && action.redirectUrl) return action.redirectUrl;
  if (decision.redirectImmediately && (action?.redirectUrl || decision.redirectUrl)) return action?.redirectUrl || decision.redirectUrl || null;
  if (action?.type === "popup_then_redirect" && action.redirectUrl) return action.redirectUrl;
  return null;
}

export class DesktopAgent {
  private running = true;
  private sessionStartMs = Date.now();
  private lastContextKey = "";
  private nextHeartbeatAtMs = 0;
  private redirectTracker: RedirectTrackerStore;
  private nullContextStreak = 0;

  constructor(private readonly deps: DesktopAgentDeps) {
    this.redirectTracker = new RedirectTrackerStore(deps.redirectTrackerMs);
  }

  stop(): void {
    this.running = false;
  }

  async runForever(): Promise<void> {
    while (this.running) {
      const ctx = await getActiveWindow();
      if (!ctx) {
        this.nullContextStreak += 1;
        if (this.nullContextStreak === 1 || this.nullContextStreak % 30 === 0) {
          const message = "desktop_no_active_window_context";
          console.warn(`[spark:desktop] ${message} (streak=${this.nullContextStreak})`);
          await this.deps.companionClient.postJson("/debug/client-log", {
            at: new Date().toISOString(),
            level: "warn",
            message,
            context: {
              platform: process.platform,
              hint: "Install/allow window detection tools/permissions (linux: xdotool or xprop; mac: Accessibility; windows: PowerShell foreground window)."
            }
          });
        }
        await sleep(this.deps.pollMs);
        continue;
      }
      this.nullContextStreak = 0;

      const event = buildEvent(ctx, this.sessionStartMs);
      const key = contextKeyFromEvent(event);

      if (key !== this.lastContextKey) {
        this.lastContextKey = key;
        await this.sendEvent(event);
      } else if (Date.now() >= this.nextHeartbeatAtMs) {
        await this.sendEvent(event);
      }

      await sleep(this.deps.pollMs);
    }
  }

  private async sendEvent(event: EventIngest): Promise<void> {
    const returnCheck = this.redirectTracker.consumeReturnState(event);
    if (returnCheck.returned) {
      event.returnedAfterRedirect = true;
      event.redirectedFromUrl = returnCheck.fromUrl;
    }

    const decision = await this.deps.companionClient.postJson<EventDecisionResponse>("/event", event);
    if (!decision) return;

    const nextSec = typeof decision.nextCheckSeconds === "number" && Number.isFinite(decision.nextCheckSeconds)
      ? Math.max(10, Math.min(21600, Math.floor(decision.nextCheckSeconds)))
      : this.deps.heartbeatDefaultSeconds;
    this.nextHeartbeatAtMs = Date.now() + nextSec * 1000;

    const redirectUrl = shouldImmediateRedirect(decision);
    if (!redirectUrl) return;

    this.redirectTracker.track(event.url, redirectUrl);
    const ok = await openExternalUrl(redirectUrl);
    if (!ok) {
      console.warn(`[spark:desktop] could not open redirect URL: ${redirectUrl}`);
    } else {
      console.log(`[spark:desktop] redirect opened: ${redirectUrl}`);
    }

    if (decision.action?.type === "popup_then_redirect" && decision.promptId) {
      await this.deps.companionClient.postJson("/interaction-feedback", {
        promptId: decision.promptId,
        selectedOption: "desktop_auto_redirect",
        timestamp: new Date().toISOString()
      });
    }
  }
}
