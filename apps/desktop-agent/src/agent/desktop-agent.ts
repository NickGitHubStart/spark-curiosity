import type { EventDecisionResponse, EventIngest } from "@spark/shared";
import { contextKeyFromEvent, buildEvent } from "../domain/context.js";
import type { ActiveWindowContext } from "../domain/types.js";
import { getActiveWindow } from "../providers/index.js";
import {
  closeCurrentTab,
  getCachedActiveWindowContext,
  isNativeWatcherAvailable,
  showPromptDialog,
  showQuoteToast,
  subscribeActiveWindowContext
} from "../providers/windows-native.js";
import { CompanionClient } from "../services/companion-client.js";

import { RedirectTrackerStore } from "./redirect-tracker.js";
import { performCloseTabOnly } from "./redirect-flow.js";

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
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceKey = "";

  /** Debounce: wait this many ms after a tab change before sending the event */
  private static readonly DEBOUNCE_MS = 4000;
  /** How often the event-driven loop checks heartbeats (not window context). */
  private static readonly HEARTBEAT_CHECK_MS = 10_000;

  constructor(private readonly deps: DesktopAgentDeps) {
    this.redirectTracker = new RedirectTrackerStore(deps.redirectTrackerMs);
  }

  stop(): void {
    this.running = false;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  async runForever(): Promise<void> {
    if (process.platform === "win32" && isNativeWatcherAvailable()) {
      await getActiveWindow();
      console.log("[spark:desktop] native watcher active — event-driven mode (no poll loop)");
      await this.runEventDriven();
      return;
    }
    console.log("[spark:desktop] poll loop mode (native watcher unavailable)");
    await this.runPollLoop();
  }

  private scheduleContextChange(ctx: ActiveWindowContext): void {
    const event = buildEvent(ctx, this.sessionStartMs);
    const key = contextKeyFromEvent(event);
    if (key === this.lastContextKey) return;

    this.lastContextKey = key;
    this.debounceKey = key;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.finishDebouncedSend(this.debounceKey);
    }, DesktopAgent.DEBOUNCE_MS);
  }

  private async finishDebouncedSend(expectedKey: string): Promise<void> {
    if (!this.running) return;

    const postCtx = getCachedActiveWindowContext() ?? await getActiveWindow();
    if (!postCtx) return;

    const postEvent = buildEvent(postCtx, this.sessionStartMs);
    const postKey = contextKeyFromEvent(postEvent);
    if (postKey !== expectedKey) {
      this.lastContextKey = postKey;
      return;
    }

    await this.sendEvent(postEvent, postCtx);
  }

  private async runEventDriven(): Promise<void> {
    const unsub = subscribeActiveWindowContext(ctx => {
      this.nullContextStreak = 0;
      this.scheduleContextChange(ctx);
    });

    const initial = getCachedActiveWindowContext();
    if (initial) this.scheduleContextChange(initial);

    while (this.running) {
      await sleep(DesktopAgent.HEARTBEAT_CHECK_MS);
      if (!this.running) break;

      const ctx = getCachedActiveWindowContext() ?? await getActiveWindow();
      if (!ctx) {
        this.nullContextStreak += 1;
        if (this.nullContextStreak === 1 || this.nullContextStreak % 30 === 0) {
          await this.logMissingContext();
        }
        continue;
      }
      this.nullContextStreak = 0;

      if (Date.now() >= this.nextHeartbeatAtMs) {
        const event = buildEvent(ctx, this.sessionStartMs);
        await this.sendEvent(event, ctx);
      }
    }

    unsub();
  }

  private async runPollLoop(): Promise<void> {
    while (this.running) {
      const ctx = await getActiveWindow();
      if (!ctx) {
        this.nullContextStreak += 1;
        if (this.nullContextStreak === 1 || this.nullContextStreak % 30 === 0) {
          await this.logMissingContext();
        }
        await sleep(this.deps.pollMs);
        continue;
      }
      this.nullContextStreak = 0;

      const event = buildEvent(ctx, this.sessionStartMs);
      const key = contextKeyFromEvent(event);

      if (key !== this.lastContextKey) {
        this.lastContextKey = key;
        await sleep(DesktopAgent.DEBOUNCE_MS);
        if (!this.running) break;
        const postCtx = await getActiveWindow();
        if (!postCtx) { await sleep(this.deps.pollMs); continue; }
        const postEvent = buildEvent(postCtx, this.sessionStartMs);
        const postKey = contextKeyFromEvent(postEvent);
        if (postKey !== key) {
          this.lastContextKey = postKey;
          continue;
        }
        await this.sendEvent(postEvent, postCtx);
      } else if (Date.now() >= this.nextHeartbeatAtMs) {
        await this.sendEvent(event, ctx);
      }

      await sleep(this.deps.pollMs);
    }
  }

  private async logMissingContext(): Promise<void> {
    const message = "desktop_no_active_window_context";
    console.warn(`[spark:desktop] ${message} (streak=${this.nullContextStreak})`);
    await this.deps.companionClient.postJson("/debug/client-log", {
      at: new Date().toISOString(),
      level: "warn",
      message,
      context: {
        platform: process.platform,
        hint: "Install/allow window detection tools/permissions (linux: xdotool or xprop; mac: Accessibility; windows: ActiveWindowWatcher.exe)."
      }
    });
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
      if (command.type === "close_tab") {
        this.redirectTracker.track(event.url, "");
        const { closed } = await performCloseTabOnly(ctx, { closeCurrentTab, sleep });
        if (!closed) console.warn("[spark:desktop] close-tab failed");
        continue;
      }
      const legacy = command as { type?: string; url?: string; closeTab?: boolean };
      if (legacy.type === "redirect") {
        this.redirectTracker.track(event.url, "");
        if (legacy.closeTab !== false) {
          const { closed } = await performCloseTabOnly(ctx, { closeCurrentTab, sleep });
          if (!closed) console.warn("[spark:desktop] legacy redirect→close failed");
        }
        continue;
      }
    }
  }
}
