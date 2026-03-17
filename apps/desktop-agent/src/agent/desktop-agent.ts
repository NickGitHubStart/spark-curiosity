import type { EventDecisionResponse, EventIngest } from "@spark/shared";
import { contextKeyFromEvent, buildEvent } from "../domain/context.js";
import type { ActiveWindowContext } from "../domain/types.js";
import { getActiveWindow } from "../providers/index.js";
import { closeCurrentTab, navigateCurrentTab, showPromptDialog, showQuoteToast } from "../providers/windows-native.js";
import { CompanionClient } from "../services/companion-client.js";
import { openExternalUrl } from "../services/url-opener.js";
import { closeTabsByUrl, openCdpUrl } from "../services/chrome-cdp.js";
import { ensureExtensionInstalled } from "../services/extension-installer.js";
import { RedirectTrackerStore } from "./redirect-tracker.js";
import { performRedirect } from "./redirect-flow.js";

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
  private lastCdpSwitchUrl = "";
  private lastCdpSwitchAt = 0;

  constructor(private readonly deps: DesktopAgentDeps) {
    this.redirectTracker = new RedirectTrackerStore(deps.redirectTrackerMs);
  }

  stop(): void {
    this.running = false;
  }

  async runForever(): Promise<void> {
    this.installExtensionOnce();
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

      if (await this.maybeSwitchToCdp(ctx)) {
        await sleep(this.deps.pollMs);
        continue;
      }

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

  private extensionInstalled = false;
  private installExtensionOnce(): void {
    if (this.extensionInstalled) return;
    this.extensionInstalled = true;
    try {
      const res = ensureExtensionInstalled();
      if (res.ok) {
        console.log(`[spark:desktop] extension installed (id=${res.id}). Chrome restart required.`);
      } else {
        console.warn(`[spark:desktop] extension install failed: ${res.reason}`);
      }
    } catch (err) {
      console.warn(`[spark:desktop] extension install error: ${String(err)}`);
    }
  }

  private async maybeSwitchToCdp(ctx: ActiveWindowContext): Promise<boolean> {
    const forceCdp = process.env.SPARK_FORCE_CDP === "1";
    if (!forceCdp) return false;
    const app = (ctx.appName || "").toLowerCase();
    if (!/(chrome|msedge)/.test(app)) return false;
    if (!ctx.url || !ctx.hwnd) return false;
    const now = Date.now();
    if (this.lastCdpSwitchUrl === ctx.url && now - this.lastCdpSwitchAt < 10_000) return false;
    const opened = await openCdpUrl(ctx.url);
    if (!opened) return false;
    this.lastCdpSwitchUrl = ctx.url;
    this.lastCdpSwitchAt = now;
    await sleep(200);
    await closeCurrentTab(ctx.hwnd);
    return true;
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

      const result = await performRedirect(ctx, command, {
        getActiveWindow,
        navigateCurrentTab,
        closeCurrentTab,
        openExternalUrl,
        closeTabsByUrl,
        openCdpUrl,
        sleep
      });
      if (result.navigated && result.verified) {
        console.log("[spark:desktop] navigated tab in-place (hwnd=%s) -> %s", ctx.hwnd, command.url);
      } else if (result.opened) {
        console.log(`[spark:desktop] redirect opened (new tab): ${command.url}`);
      } else {
        console.warn(`[spark:desktop] could not open redirect target: ${command.url}`);
      }
      if (command.closeTab && !result.closed) {
        console.warn("[spark:desktop] close-tab failed");
      }
    }
  }
}
