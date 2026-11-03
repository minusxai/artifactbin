import { build, version as esbuildVersion } from 'esbuild';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const imports = new Set([
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai/utils/event-stream",
    "abort-controller/dist/abort-controller.mjs",
    "fast-text-encoding",
    "core-js/web/url",
    "core-js/web/structured-clone",
]);
const OPTIONS = { bundle: true, write: false, platform: "browser", format: "iife", globalName: "Program", logLevel: "silent" } as const;
/** Everything besides the source that decides a bundle's bytes. Bump the suffix when the plugin below changes. */
export const COMPILER_VERSION = `esbuild ${esbuildVersion}; ` + createHash('sha256').update(JSON.stringify([OPTIONS, [...imports].sort(), 'ts-loader', 'fixed-imports@1'])).digest('hex').slice(0, 16);
async function compile(source: string) {
    const out = await build({
        ...OPTIONS,
        entryPoints: ["program:entry"],
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
export interface BundleCacheOptions { compile: (source: string) => Promise<string>; version: string; maxEntries?: number; maxBytes?: number; /** Shared between caches of different compiler versions, as a persisted store would be. */ store?: Map<string, string> }
/**
 * Bundles by content: a bundle is a pure function of the source and the compiler, so the key is
 * sha256(source) plus the compiler version. Concurrent misses share one build; failures are never kept.
 */
export function createBundleCache({ compile, version, maxEntries = 256, maxBytes = 64 * 1024 * 1024, store }: BundleCacheOptions) {
    const done = store ?? new Map<string, string>(), building = new Map<string, Promise<string>>();
    let bytes = [...done.values()].reduce((sum, text) => sum + Buffer.byteLength(text), 0);
    return async function bundle(source: string): Promise<string> {
        if (Buffer.byteLength(source) > 256 * 1024)
            throw Error("source_limit");
        const key = createHash('sha256').update(version).update('\0').update(source).digest('hex');
        const hit = done.get(key);
        if (hit !== undefined) {
            done.delete(key);
            done.set(key, hit);
            return hit;
        }
        const pending = building.get(key);
        if (pending)
            return pending;
        const started = compile(source).then(text => {
            const size = Buffer.byteLength(text);
            if (size <= maxBytes) {
                done.set(key, text);
                bytes += size;
                for (const [oldest, value] of done) {
                    if (done.size <= maxEntries && bytes <= maxBytes)
                        break;
                    done.delete(oldest);
                    bytes -= Buffer.byteLength(value);
                }
            }
            return text;
        }).finally(() => building.delete(key));
        building.set(key, started);
        return started;
    };
}
export const bundleSource = createBundleCache({ compile, version: COMPILER_VERSION });
