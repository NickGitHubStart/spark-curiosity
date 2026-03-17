import type { ActiveWindowContext } from "../domain/types.js";

export type RedirectCommand = {
  url: string;
  closeTab?: boolean;
};

export type RedirectDeps = {
  getActiveWindow: () => Promise<ActiveWindowContext | null>;
  navigateCurrentTab: (hwnd: string | undefined, url: string) => Promise<boolean>;
  closeCurrentTab: (hwnd?: string) => Promise<boolean>;
  openExternalUrl: (url: string) => Promise<boolean>;
  closeTabsByUrl?: (url: string) => Promise<boolean>;
  openCdpUrl?: (url: string) => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
};

export type RedirectResult = {
  closed: boolean;
  opened: boolean;
  navigated: boolean;
  verified: boolean;
};

function sameDestination(currentUrl: string | undefined, targetUrl: string): boolean {
  if (!currentUrl) return false;
  try {
    const current = new URL(currentUrl);
    const target = new URL(targetUrl);
    if (current.host !== target.host) return false;
    if (target.pathname && target.pathname !== "/" && !current.pathname.startsWith(target.pathname)) return false;
    return true;
  } catch {
    return currentUrl.startsWith(targetUrl);
  }
}

/**
 * Redirect strategy (ordered by reliability):
 * 1. CDP close bad tab + CDP open curated tab  (most reliable if CDP available)
 * 2. Keyboard navigate-in-place (Ctrl+L, paste, Enter)  — replaces tab content
 * 3. Keyboard close (Ctrl+W) + open new tab via OS
 */
export async function performRedirect(
  ctx: ActiveWindowContext,
  command: RedirectCommand,
  deps: RedirectDeps
): Promise<RedirectResult> {
  const result: RedirectResult = { closed: false, opened: false, navigated: false, verified: false };

  // --- Strategy 1: CDP open-first + close (most reliable, preserves window) ---
  // IMPORTANT: Open the new tab FIRST, then close the bad one.
  // If bad tab is the only tab, closing it first would close the Chrome window entirely.
  if (ctx.url && deps.closeTabsByUrl && deps.openCdpUrl) {
    try {
      const cdpOpened = await deps.openCdpUrl(command.url);
      if (cdpOpened) {
        result.opened = true;
        await deps.sleep(200);
        result.closed = await deps.closeTabsByUrl(ctx.url);
        result.navigated = true;
        result.verified = true;
        console.log("[spark:redirect] CDP open-first+close succeeded (opened=%s closed=%s)", result.opened, result.closed);
        return result;
      }
    } catch {
      // CDP not available, continue to keyboard fallback
    }
  }

  // --- Strategy 2: Keyboard navigate-in-place (3 attempts, increasing delays) ---
  if (ctx.hwnd && ctx.url) {
    const delays = [600, 900, 1200];
    for (let attempt = 0; attempt < 3; attempt++) {
      result.navigated = await deps.navigateCurrentTab(ctx.hwnd, command.url);
      if (result.navigated) {
        await deps.sleep(delays[attempt]);
        const post = await deps.getActiveWindow();
        result.verified = Boolean(post?.url && sameDestination(post.url, command.url));
        if (result.verified) {
          console.log("[spark:redirect] keyboard navigate-in-place verified (attempt=%d)", attempt + 1);
          return result;
        }
      }
      await deps.sleep(300);
    }
  }

  // --- Strategy 3: Open new tab first, then close old tab ---
  // Always open the target first so Chrome window stays alive even if bad tab is the only one.
  if (deps.openCdpUrl) {
    try { result.opened = await deps.openCdpUrl(command.url); } catch { /* ignore */ }
  }
  if (!result.opened) {
    result.opened = await deps.openExternalUrl(command.url);
  }

  // Now close the bad tab (only after new tab is open)
  if (command.closeTab !== false) {
    await deps.sleep(300);

    // Try CDP close
    if (ctx.url && deps.closeTabsByUrl) {
      try { result.closed = await deps.closeTabsByUrl(ctx.url); } catch { /* ignore */ }
    }

    // Try keyboard close (Ctrl+W) with retries
    if (!result.closed && ctx.hwnd) {
      for (let i = 0; i < 3; i++) {
        result.closed = await deps.closeCurrentTab(ctx.hwnd);
        if (result.closed) break;
        await deps.sleep(200 + i * 150);
      }
    }
  }

  return result;
}
