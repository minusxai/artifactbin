import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { chmod } from "node:fs/promises";
await build({
  entryPoints: { afbin: "src/main.ts", index: "src/index.ts" },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["node-pty"],
  banner: { js: "#!/usr/bin/env node" },
});
await chmod("dist/afbin.mjs", 0o755);

execFileSync(
  process.execPath,
  [
    createRequire(import.meta.url).resolve("typescript/bin/tsc"),
    "-p",
    "tsconfig.build.json",
  ],
  { stdio: "inherit" },
);
