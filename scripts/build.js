import { spawnSync } from "node:child_process";
import { chromeCSS } from "../src/chrome-assets.js";
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { encodeRuntime } from "./encode-runtime.js";
import { checkBuiltApp } from "./check-boundaries.ts";
const assertAppBoundary = (metafile, entry) => {
  const violations = checkBuiltApp(metafile, entry);
  if (violations.length)
    throw Error(violations.map((v) => v.message).join("\n"));
};
mkdirSync("dist", { recursive: true });
const bridge = await build({
  entryPoints: ["src/browser/bridge.js"],
  bundle: true,
  write: false,
  format: "iife",
  target: "es2022",
  minify: true,
  metafile: true,
});
const result = await build({
  entryPoints: ["src/browser/runtime.js"],
  bundle: true,
  write: false,
  format: "iife",
  target: "es2022",
  minify: true,
  metafile: true,
  define: {
    PAGEGI_BRIDGE: JSON.stringify(bridge.outputFiles[0].text),
    PAGEGI_CSS: JSON.stringify(
      chromeCSS + readFileSync("src/browser/style.css", "utf8"),
    ),
  },
});
assertAppBoundary(result.metafile, "src/browser/runtime.js");
assertAppBoundary(bridge.metafile, "src/browser/bridge.js");
const portableRuntime = encodeRuntime(result.outputFiles[0].text);
writeFileSync("dist/runtime.js", portableRuntime);
writeFileSync("dist/runtime.meta.json", JSON.stringify(result.metafile));
writeFileSync("dist/bridge.meta.json", JSON.stringify(bridge.metafile));
for (const [name, entry] of [
  ["runner", "src/browser/runner.js"],
  ["platform-frame", "src/browser/platform-frame.ts"],
  ["trusted-connection", "src/browser/trusted-connection.ts"],
]) {
  const output = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2022",
    minify: true,
    metafile: true,
  });
  if (name === "runner") assertAppBoundary(output.metafile, entry);
  writeFileSync(`dist/${name}.js`, encodeRuntime(output.outputFiles[0].text));
  writeFileSync(`dist/${name}.meta.json`, JSON.stringify(output.metafile));
}
// The core: /af/v1/core.js, a classic script every page loads first in <head>.
// HTML-safe, because a downloaded page inlines it in a <script data-af="core">.
const core = await build({
  entryPoints: ["src/browser/core/core.ts"],
  bundle: true,
  write: false,
  format: "iife",
  target: "es2022",
  minify: true,
  metafile: true,
  legalComments: "none",
});
assertAppBoundary(core.metafile, "src/browser/core/core.ts");
writeFileSync("dist/core.js", encodeRuntime(core.outputFiles[0].text));
writeFileSync("dist/core.meta.json", JSON.stringify(core.metafile));
console.log("Built Pagegi runtime and core");

// Trusted library entry: bundle typed controllers while preserving existing UI assets.
await build({
  entryPoints: ["src/home.js"],
  plugins: [
    {
      name: "home-http-imports",
      setup(builder) {
        builder.onResolve(
          { filter: /^\.\/(browser\/sharing|navigation)\.js$/ },
          (args) =>
            args.importer.endsWith("/src/home.js")
              ? {
                  path: args.path.includes("sharing")
                    ? "/sharing.js"
                    : "/navigation.js",
                  external: true,
                }
              : undefined,
        );
      },
    },
  ],
  bundle: true,
  outfile: "dist/home.js",
  format: "esm",
  target: "es2022",
  external: ["/account.js", "/sharing.js", "/navigation.js", "/identity.js"],
});

// Pack the install-only executable for registry-independent npx installation.
const packedInstaller = spawnSync("npm", ["pack", "--json", "--pack-destination", "../dist"], {
  cwd: "installer", encoding: "utf8",
});
if (packedInstaller.status !== 0) throw Error(packedInstaller.stderr || "Installer packaging failed");
const installerFilename = JSON.parse(packedInstaller.stdout)[0].filename;
writeFileSync("dist/artefactbin-skill.tgz", readFileSync(`dist/${installerFilename}`));
