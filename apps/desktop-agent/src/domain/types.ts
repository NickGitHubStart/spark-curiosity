export type AudioSnapshot = {
  pkg: string;
  title?: string;
  state: "playing";
  peak?: number;
  sessions?: number;
};

export type ActiveWindowContext = {
  appName: string;
  title: string;
  url?: string;
  /** Windows: foreground window handle (for --close-tab targeting). */
  hwnd?: string;
  /** Windows: currently-playing audio session (WASAPI), null when silent. */
  audio?: AudioSnapshot;
};

export type RedirectTracker = {
  fromUrl: string;
  toUrl: string;
  redirectedAtMs: number;
};
