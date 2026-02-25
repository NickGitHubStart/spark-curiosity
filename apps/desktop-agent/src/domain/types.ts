export type ActiveWindowContext = {
  appName: string;
  title: string;
  url?: string;
};

export type RedirectTracker = {
  fromUrl: string;
  toUrl: string;
  redirectedAtMs: number;
};
