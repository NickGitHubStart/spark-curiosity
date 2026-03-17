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
    if (target.pathname && !current.pathname.startsWith(target.pathname)) return false;
    return true;
  } catch {
    return currentUrl.startsWith(targetUrl);
  }
}

export async function performRedirect(
  ctx: ActiveWindowContext,
  command: RedirectCommand,
  deps: RedirectDeps
): Promise<RedirectResult> {
  const result: RedirectResult = { closed: false, opened: false, navigated: false, verified: false };

  if (command.closeTab) {
    if (ctx.url && deps.closeTabsByUrl) {
      result.closed = await deps.closeTabsByUrl(ctx.url);
      await deps.sleep(150);
    }
    if (!result.closed && ctx.hwnd) {
      result.closed = await deps.closeCurrentTab(ctx.hwnd);
      await deps.sleep(200);
    }
    if (deps.openCdpUrl) {
      result.opened = await deps.openCdpUrl(command.url);
      if (result.opened) return result;
    }
    result.opened = await deps.openExternalUrl(command.url);
    return result;
  }

  if (ctx.hwnd && ctx.url) {
    result.navigated = await deps.navigateCurrentTab(ctx.hwnd, command.url);
    if (result.navigated) {
      await deps.sleep(350);
      const post = await deps.getActiveWindow();
      result.verified = Boolean(post?.url && sameDestination(post.url, command.url));
      if (result.verified) return result;
    }
  }

  result.opened = await deps.openExternalUrl(command.url);
  return result;
}
