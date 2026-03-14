export type ActiveWindowContext = {
  appName: string;
  title: string;
  url?: string;
  /** Windows: foreground window handle (for --close-tab targeting). */
  hwnd?: string;
};

export type RedirectTracker = {
  fromUrl: string;
  toUrl: string;
  redirectedAtMs: number;
};
