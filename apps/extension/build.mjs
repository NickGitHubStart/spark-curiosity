import { build } from "esbuild";
import { rmSync } from "fs";

rmSync("dist", { recursive: true, force: true });

const shared = {
  bundle: true,
  format: "esm",
  target: "es2022",
  outdir: "dist",
  sourcemap: true,
  logLevel: "info",
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ["src/background.ts"],
    entryNames: "background",
  }),
  build({
    ...shared,
    entryPoints: ["src/content.ts"],
    entryNames: "content",
  }),
]);
