import type { EventIngest } from "@spark/shared";
import type { RedirectTracker } from "../domain/types.js";

export class RedirectTrackerStore {
  private tracker: RedirectTracker | null = null;

  constructor(private readonly ttlMs: number) {}

  track(fromUrl: string, toUrl: string): void {
    this.tracker = { fromUrl, toUrl, redirectedAtMs: Date.now() };
  }

  consumeReturnState(event: EventIngest): { returned: boolean; fromUrl?: string } {
    if (!this.tracker) return { returned: false };

    const age = Date.now() - this.tracker.redirectedAtMs;
    if (age > this.ttlMs) {
      this.tracker = null;
      return { returned: false };
    }

    try {
      const currentHost = new URL(event.url).hostname;
      const fromHost = new URL(this.tracker.fromUrl).hostname;
      if (event.url === this.tracker.fromUrl || currentHost === fromHost) {
        const fromUrl = this.tracker.fromUrl;
        this.tracker = null;
        return { returned: true, fromUrl };
      }
    } catch {
      // ignore malformed URLs
    }

    return { returned: false };
  }
}
