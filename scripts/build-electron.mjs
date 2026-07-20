import { build } from "esbuild";
import fs from "node:fs/promises";

await fs.mkdir(".electron-build", { recursive: true });

await Promise.all([
  build({
    entryPoints: ["src/main/index.ts"],
    outfile: ".electron-build/runtime.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["electron"],
    sourcemap: true,
  }),
  build({
    entryPoints: ["src/preload.ts"],
    outfile: ".electron-build/preload.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["electron"],
    sourcemap: true,
  }),
]);
