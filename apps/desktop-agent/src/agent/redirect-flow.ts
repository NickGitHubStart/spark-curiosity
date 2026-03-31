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
    const a = new URL(currentUrl);
    const b = new URL(targetUrl);
    return a.host === b.host && (b.pathname === "/" || a.pathname.startsWith(b.pathname));
  } catch {
    return currentUrl.startsWith(targetUrl);
  }
}

/**
 * Desktop-agent redirect fallback (when extension is not active).
 * Strategy 1: keyboard navigate-in-place (Ctrl+L → paste → Enter)
 * Strategy 2: OS open new tab + native close old tab
 */
export async function performRedirect(
  ctx: ActiveWindowContext,
  command: RedirectCommand,
  deps: RedirectDeps
): Promise<RedirectResult> {
  const result: RedirectResult = { closed: false, opened: false, navigated: false, verified: false };
  const wantClose = command.closeTab !== false;

  // ── Strategy 1: keyboard navigate-in-place (3 attempts) ──
  if (ctx.hwnd) {
    // Increasing delays: the browser needs time to navigate and update the URL bar.
    // Ctrl+L → paste → Enter is unreliable — verify after each attempt.
    const delays = [600, 900, 1200];
    for (let i = 0; i < delays.length; i++) {
      result.navigated = await deps.navigateCurrentTab(ctx.hwnd, command.url);
      if (!result.navigated) break;
      await deps.sleep(delays[i]);
      const post = await deps.getActiveWindow();
      result.verified = Boolean(post?.url && sameDestination(post.url, command.url));
      if (result.verified) {
        console.log("[spark:redirect] navigate-in-place ok (attempt %d)", i + 1);
        return result;
      }
    }
  }

  // ── Strategy 2: close old tab first, then open new ──
  // Must close BEFORE opening, because openExternalUrl gives the new tab focus,
  // and closeCurrentTab targets the *active* tab in the window — which would be
  // the new tab if we opened it first.
  // Note: closeCurrentTab works without hwnd (sends Ctrl+W to active window).
  if (wantClose) {
    result.closed = await deps.closeCurrentTab(ctx.hwnd);
    await deps.sleep(300);
  }
  result.opened = await deps.openExternalUrl(command.url);
  return result;
}
