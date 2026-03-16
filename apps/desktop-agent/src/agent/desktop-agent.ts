import type { EventDecisionResponse, EventIngest } from "@spark/shared";
import { contextKeyFromEvent, buildEvent } from "../domain/context.js";
import type { ActiveWindowContext } from "../domain/types.js";
import { getActiveWindow } from "../providers/index.js";
import { navigateCurrentTab, showPromptDialog, showQuoteToast } from "../providers/windows-native.js";
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
        await this.sendEvent(event, ctx);
      } else if (Date.now() >= this.nextHeartbeatAtMs) {
        await this.sendEvent(event, ctx);
      }

      await sleep(this.deps.pollMs);
    }
  }

  private async sendEvent(event: EventIngest, ctx: ActiveWindowContext): Promise<void> {
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

    if (!decision.commands?.length) return;

    for (const command of decision.commands) {
      if (!command) continue;
      if (command.type === "quote") {
        await showQuoteToast(command.text, command.author);
        continue;
      }
      if (command.type === "prompt") {
        await showPromptDialog(command.question);
        continue;
      }
      if (command.type !== "redirect" || !command.url) continue;

      this.redirectTracker.track(event.url, command.url);

      if (ctx.hwnd && ctx.url) {
        const ok = await navigateCurrentTab(ctx.hwnd, command.url);
        if (ok) {
          console.log("[spark:desktop] navigated tab in-place (hwnd=%s) -> %s", ctx.hwnd, command.url);
          continue;
        }
        console.warn("[spark:desktop] navigate-tab failed, falling back to open");
      }

      const ok = await openExternalUrl(command.url);
      if (!ok) {
        console.warn(`[spark:desktop] could not open redirect target: ${command.url}`);
      } else {
        console.log(`[spark:desktop] redirect opened (new tab): ${command.url}`);
      }
    }
  }
}
