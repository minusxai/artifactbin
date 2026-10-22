import { createHash } from "node:crypto";
import { build } from "esbuild";
import { admitLegacyServerModule } from "./server-module-admission.ts";
import type { CompileLegacyServerModule } from "./server-module-contracts.ts";
/** Build a server-only invocation factory. Compilation never imports or evaluates authored code. */
export const compileLegacyServerModule: CompileLegacyServerModule = async (
  source,
  declarations,
) => {
  const references = admitLegacyServerModule(source, declarations);
  const output = await build({
    stdin: { contents: source, loader: "js", sourcefile: "legacy-server.js" },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    globalName: "__legacyServerModule",
    target: "es2022",
    logLevel: "silent",
    plugins: [
      {
        name: "fixed-server-page-bindings",
        setup(plugin) {
          plugin.onResolve({ filter: /.*/ }, (args) =>
            args.path === "page"
              ? { path: "page", namespace: "legacy-server-page" }
              : { errors: [{ text: "Unsupported server import" }] },
          );
          plugin.onLoad(
            { filter: /.*/, namespace: "legacy-server-page" },
            () => ({
              loader: "js",
              contents: ["signal", "query", "mutation"]
                .map(
                  (name) =>
                    `export const ${name}=(ref)=>__legacyServerBindings.${name}(ref);`,
                )
                .join("\n"),
            }),
          );
        },
      },
    ],
  });
  const code = output.outputFiles[0]!.text;
  if (new TextEncoder().encode(code).length > 2 * 1024 * 1024)
    throw Error("Compiled server module exceeds supported size");
  return {
    factorySource: `function(__legacyServerBindings){${code}\nreturn __legacyServerModule.default;}`,
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    references,
  };
};
