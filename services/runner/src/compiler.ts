import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
const imports = new Set([
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai/utils/event-stream",
    "abort-controller/dist/abort-controller.mjs",
    "fast-text-encoding",
    "core-js/web/url",
    "core-js/web/structured-clone",
]);
export async function bundleSource(source: string) {
    if (Buffer.byteLength(source) > 256 * 1024)
        throw Error("source_limit");
    const out = await build({
        entryPoints: ["program:entry"],
        bundle: true,
        write: false,
        platform: "browser",
        format: "iife",
        globalName: "Program",
        logLevel: "silent",
        plugins: [
            {
                name: "fixed-imports",
                setup(b) {
                    b.onResolve({ filter: /^program:entry$/ }, () => ({
                        path: "entry",
                        namespace: "user-program",
                    }));
                    b.onLoad({ filter: /.*/, namespace: "user-program" }, () => ({
                        contents: source,
                        loader: "ts",
                    }));
                    b.onResolve({ filter: /.*/, namespace: "user-program" }, (args) => imports.has(args.path)
                        ? {
                            path: fileURLToPath(import.meta.resolve(args.path.startsWith("core-js/")
                                ? args.path + ".js"
                                : args.path)),
                        }
                        : { errors: [{ text: "import_not_allowed: " + args.path }] });
                },
            },
        ],
    });
    return out.outputFiles[0]!.text;
}
export async function bundleProgram(filename: string) {
    return bundleSource(await readFile(filename, "utf8"));
}
