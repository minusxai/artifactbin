/**
 * npm imports in backend files. A backend file imports a package pinned to an
 * exact version (`import postgres from "postgres@3.4.5"`); at compile time the
 * execution service fetches it from esm.sh, built for workerd, together with
 * every esm.sh module it imports, and hands the texts to the compile sandbox,
 * which bundles them with esbuild (container/bundle.mjs) without any network.
 * `node:*` and `cloudflare:*` imports are left to the runtime. What was
 * fetched is recorded in the deployment's lockfile.
 */
import { createHash } from "node:crypto";
import { stripTypeScriptTypes } from "node:module";
import { parse } from "acorn";
import {
  BackendHostError,
  type BackendLockfile,
  type ModuleFetcher,
  type OwnedModuleFetcher,
} from "./contracts.ts";

export const ESM_ORIGIN = "https://esm.sh";
/** esm.sh's build for workerd: one bundled module per package, sockets through `cloudflare:sockets`. */
export const ESM_QUERY = "target=esnext&bundle&conditions=workerd";
/** The bundle's only external imports; container/bundle.mjs applies the same rule. */
export const BUILTIN = /^(?:node|cloudflare):[a-z0-9_/.-]+$/;
const NAME = String.raw`(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*`;
const VERSION = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`;
const SUBPATH = String.raw`(?:\/(?!\.\.?(?:\/|$))[A-Za-z0-9._~-]+)*`;
/** `pg@8.13.1`, `@scope/pkg@1.0.0`, `pkg@1.0.0/sub/path`. */
export const PINNED_PACKAGE = new RegExp(`^${NAME}@${VERSION}${SUBPATH}$`);
const BARE = new RegExp(`^(${NAME})(?:@[^/\\s]*)?${SUBPATH}$`);

export type ImportKind =
  /** `@afbin/apollo`, the built-in gql shim. */
  | "apollo"
  /** `node:*` / `cloudflare:*`, provided by the runtime. */
  | "builtin"
  /** An npm package pinned to an exact version. */
  | "package"
  /** An npm package without an exact version. */
  | "unpinned"
  /** A path, URL or anything else. */
  | "refused";

export function importKind(specifier: string): ImportKind {
  if (specifier === "@afbin/apollo") return "apollo";
  if (BUILTIN.test(specifier)) return "builtin";
  if (PINNED_PACKAGE.test(specifier)) return "package";
  if (BARE.test(specifier)) return "unpinned";
  return "refused";
}

/** What to tell an author who wrote an unpinned import. */
export function pinAdvice(specifier: string): string {
  const name = BARE.exec(specifier)?.[1] ?? specifier;
  return `pin "${specifier}" to an exact version, such as "${name}@1.2.3"`;
}

export const esmUrl = (specifier: string) =>
  `${ESM_ORIGIN}/${specifier}?${ESM_QUERY}`;

interface Node {
  type: string;
  [key: string]: unknown;
}

/**
 * The import specifiers of an ES module (TypeScript when `typescript`):
 * static imports and re-exports, literal dynamic imports, and whether any
 * dynamic import is computed. Throws when the text does not parse.
 */
export function moduleImports(
  code: string,
  typescript = false,
): { specifiers: string[]; computed: boolean } {
  let text = code;
  if (typescript)
    try {
      text = stripTypeScriptTypes(code, { mode: "strip" });
    } catch {
      text = stripTypeScriptTypes(code, { mode: "transform" });
    }
  const program = parse(text, {
    ecmaVersion: "latest",
    sourceType: "module",
  }) as unknown as Node;
  const specifiers = new Set<string>();
  let computed = false;
  const stack: Node[] = [program];
  while (stack.length) {
    const node = stack.pop()!;
    if (
      (node.type === "ImportDeclaration" ||
        node.type === "ExportAllDeclaration" ||
        node.type === "ExportNamedDeclaration" ||
        node.type === "ImportExpression") &&
      node.source
    ) {
      const source = node.source as Node;
      if (source.type === "Literal" && typeof source.value === "string")
        specifiers.add(source.value);
      else computed = true;
    }
    for (const value of Object.values(node))
      for (const item of Array.isArray(value) ? value : [value])
        if (item && typeof item === "object" && typeof item.type === "string")
          stack.push(item as Node);
  }
  return { specifiers: [...specifiers], computed };
}

/** How long a compile may spend fetching its packages, before the 10 s compile watchdog starts. */
export const PACKAGE_BUDGET_MS = 20000;

const rejected = (detail: string) =>
  new BackendHostError("build_rejected", detail);

import type {
  PackageFetchBudget,
  PackageGraphLimits,
} from "./package-contracts.ts";
import type { BackendClock } from "./runtime-contracts.ts";
const realTiming: BackendClock = {
  now: () => Date.now(),
  after(milliseconds, callback) {
    const timer = setTimeout(callback, milliseconds);
    return () => clearTimeout(timer);
  },
};

export interface EsmFetcherOptions extends PackageFetchBudget {
  timing?: BackendClock;
  fetch?: typeof globalThis.fetch;
  /** Tries per URL; transient failures (network, 429, 5xx) are retried. */
  attempts?: number;
  /** Deadline per shared URL load from its first fetch, including retries and wrapper resolution (not queueing). */
  timeoutMs?: number;
  maxBytes?: number;
  /** Successful fetches are cached by URL for an hour, at most this many bytes in all (default 32 MiB). */
  cacheBytes?: number;
  /** Waits between tries; tests make it instant. */
  delay?: (ms: number) => Promise<void>;
}

/** The execution service's esm.sh client: retries, a bounded cache, and esm.sh only. */
export function createEsmFetcher(
  options: EsmFetcherOptions = {},
): OwnedModuleFetcher {
  const lifecycle = new AbortController();
  const pending = new Set<Promise<unknown>>();
  let closing: Promise<void> | undefined;
  const timing = options.timing ?? realTiming;
  const maxConcurrent = options.maxConcurrent ?? 4,
    maxPending = options.maxPending ?? 64;
  if (
    ![maxConcurrent, maxPending].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    ) ||
    maxConcurrent > maxPending
  )
    throw Error("Invalid package fetch budget");
  let active = 0;
  const queue: Array<() => void> = [];
  function pump() {
    while (active < maxConcurrent && queue.length) queue.shift()!();
  }
  const fetch = options.fetch ?? globalThis.fetch;
  const attempts = options.attempts ?? 3,
    timeoutMs = options.timeoutMs ?? 10000,
    maxBytes = options.maxBytes ?? 1048576,
    cacheBytes = options.cacheBytes ?? 32 * 1048576;
  const delay = (ms: number, signal: AbortSignal) => {
    if (options.delay) return untilAborted(options.delay(ms), signal);
    return new Promise<void>((resolve, reject) => {
      const abort = () => {
        cancel();
        reject(signal.reason);
      };
      const cancel = timing.after(ms, () => {
        signal.removeEventListener("abort", abort);
        resolve();
      });
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  };
  const cache = new Map<
    string,
    { at: number; bytes: number; value: Promise<{ url: string; code: string }> }
  >();
  let cached = 0;
  const evict = (url: string) => {
    const entry = cache.get(url);
    if (!entry) return;
    cached -= entry.bytes;
    cache.delete(url);
  };

  /** Let go of a body without waiting: a stalled cancel never turns a permanent error into a timeout. */
  const discard = (response: Response) => {
    response.body?.cancel().catch(() => {});
  };

  /** One GET, bounded by its own timeout; the body is counted as it streams and cut off past maxBytes. */
  async function once(url: string, signal: AbortSignal) {
    if (lifecycle.signal.aborted) throw lifecycle.signal.reason;
    const response = await fetch(url, {
      redirect: "follow",
      signal,
    });
    const final = new URL(response.url || url);
    if (final.origin !== ESM_ORIGIN) {
      discard(response);
      throw Object.assign(Error("redirected away from esm.sh"), {
        permanent: true,
      });
    }
    if (response.status !== 200) {
      discard(response);
      const error = Error(`HTTP ${response.status}`);
      if (response.status !== 429 && response.status < 500)
        (error as Error & { permanent?: boolean }).permanent = true;
      throw error;
    }
    const tooLarge = () =>
      Object.assign(Error("module too large"), { permanent: true });
    if (Number(response.headers.get("content-length") ?? 0) > maxBytes) {
      discard(response);
      throw tooLarge();
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          // Never waited for: a body that stalls on cancel must not delay the answer.
          reader.cancel().catch(() => {});
          throw tooLarge();
        }
        chunks.push(value);
      }
    }
    const code = new TextDecoder().decode(Buffer.concat(chunks));
    return { url: final.href, code, path: response.headers.get("x-esm-path") };
  }

  async function retried(url: string, signal: AbortSignal) {
    for (let attempt = 1; ; attempt++) {
      try {
        if (signal.aborted) throw signal.reason;
        return await once(url, signal);
      } catch (error) {
        if (
          signal.aborted ||
          (error as { permanent?: boolean }).permanent ||
          attempt >= attempts
        )
          throw error;
        await delay(250 * 2 ** (attempt - 1), signal);
      }
    }
  }

  async function load(url: string, signal: AbortSignal) {
    const first = await retried(url, signal);
    // esm.sh answers a package URL with a small re-export of the real build; its
    // path is in x-esm-path. Fetch that module itself so imports resolve against it.
    if (
      first.path &&
      first.path.startsWith("/") &&
      new URL(first.path, ESM_ORIGIN).pathname !== new URL(first.url).pathname
    ) {
      const target = new URL(first.path, ESM_ORIGIN);
      if (target.origin !== ESM_ORIGIN) throw Error("not an esm.sh URL");
      const real = await retried(target.href, signal);
      return { url: real.url, code: real.code };
    }
    return { url: first.url, code: first.code };
  }

  /** The shared fetch for `url`: started without any caller's signal, so one caller giving up never fails another. */
  function shared(url: string) {
    const hit = cache.get(url);
    if (hit && timing.now() - hit.at < 3600000) {
      cache.delete(url);
      cache.set(url, hit);
      return hit.value;
    }
    if (hit) evict(url);
    // Transient: the service is busy fetching for others, nothing is wrong with the source.
    if (pending.size >= maxPending)
      return Promise.reject(new BackendHostError("backend_busy"));
    let resolve!: (value: { url: string; code: string }) => void;
    let reject!: (reason: unknown) => void;
    const value = new Promise<{ url: string; code: string }>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const request = new AbortController();
    const signal = AbortSignal.any([lifecycle.signal, request.signal]);
    // Only closing ends queued work; the load's own deadline starts with its first fetch.
    const abortQueued = () => {
      const index = queue.indexOf(start);
      if (index < 0) return; // Active work drains its own transport before settling.
      queue.splice(index, 1);
      signal.removeEventListener("abort", abortQueued);
      reject(signal.reason);
    };
    const start = () => {
      signal.removeEventListener("abort", abortQueued);
      const cancel = timing.after(timeoutMs, () =>
        request.abort(Error("package fetch deadline")),
      );
      active++;
      load(url, signal)
        .then(resolve, reject)
        .finally(() => {
          cancel();
          active--;
          pump();
        })
        .catch(() => {});
    };
    queue.push(start);
    signal.addEventListener("abort", abortQueued, { once: true });
    pending.add(value);
    void value.finally(() => pending.delete(value)).catch(() => {});
    const entry = { at: timing.now(), bytes: 0, value };
    cache.set(url, entry);
    value.then(
      (module) => {
        if (cache.get(url) !== entry) return;
        entry.bytes = Buffer.byteLength(module.code);
        cached += entry.bytes;
        // The oldest entries make room; the service's memory is small.
        for (const oldest of cache.keys()) {
          if (cached <= cacheBytes) break;
          evict(oldest);
        }
      },
      () => {
        if (cache.get(url) === entry) cache.delete(url);
      },
    );
    pump();
    return value;
  }

  const fetchModule: ModuleFetcher = (url, signal) => {
    if (lifecycle.signal.aborted)
      return Promise.reject(lifecycle.signal.reason);
    if (!url.startsWith(ESM_ORIGIN + "/"))
      return Promise.reject(Error("not an esm.sh URL"));
    return untilAborted(shared(url), signal);
  };
  return Object.assign(fetchModule, {
    close() {
      if (!closing) {
        lifecycle.abort();
        while (queue.length) queue.shift()!();
        closing = Promise.allSettled([...pending]).then(() => {
          cache.clear();
          cached = 0;
        });
      }
      return closing;
    },
  });
}

/** `work`, or a rejection as soon as `signal` aborts (the work itself goes on). */
function untilAborted<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export interface ResolvedPackages {
  /** Each pinned import as written → its module key. */
  packages: Record<string, string>;
  /** Module key (the URL requested) → the module's final URL and text. */
  modules: Record<string, { url: string; code: string }>;
  lockfile: BackendLockfile;
}

const sorted = <T>(record: Record<string, T>): Record<string, T> =>
  Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );

/**
 * Fetch the pinned packages a backend file imports and every esm.sh module
 * they import, until only `node:*` / `cloudflare:*` imports remain. Throws
 * BackendHostError("build_rejected") naming the package on any failure.
 */
export async function resolvePackages(
  specifiers: readonly string[],
  fetchModule: ModuleFetcher,
  signal?: AbortSignal,
  limits: PackageGraphLimits = {},
): Promise<ResolvedPackages> {
  const maxModules = limits.maxModules ?? 64,
    maxBytes = limits.maxBytes ?? 1048576,
    budgetMs = limits.budgetMs ?? PACKAGE_BUDGET_MS;
  // The whole resolution has its own budget, ahead of the compile watchdog.
  const concurrency = limits.maxConcurrent ?? 4;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1)
    throw rejected("Invalid package graph concurrency");
  const timing = limits.timing ?? realTiming;
  const timer = new AbortController();
  const budget = timer.signal;
  const cancelBudget = timing.after(budgetMs, () =>
    timer.abort(Error("package budget")),
  );
  const stop = signal ? AbortSignal.any([signal, budget]) : budget;
  try {
    return await resolveWithin();
  } finally {
    cancelBudget();
  }
  async function resolveWithin(): Promise<ResolvedPackages> {
    const packages: Record<string, string> = {};
    const modules: Record<string, { url: string; code: string }> = {};
    const lockfile: Record<string, { url: string; integrity: string }> = {};
    let bytes = 0;
    type Item = { key: string; lockKey: string; pkg: string };
    let wave: Item[] = [];
    const queued = new Set<string>();
    for (const specifier of specifiers) {
      if (importKind(specifier) !== "package")
        throw rejected(`"${specifier}" is not a pinned npm package`);
      const key = esmUrl(specifier);
      packages[specifier] = key;
      if (!queued.has(key)) {
        queued.add(key);
        wave.push({ key, lockKey: specifier, pkg: specifier });
      }
    }
    while (wave.length) {
      if (queued.size > maxModules)
        throw rejected(
          `npm package "${wave[0]!.pkg}" needs more than ${maxModules} modules`,
        );
      // Each module counts toward the total as soon as it arrives, not after the whole wave.
      const loaded: Array<{
        item: Item;
        module: { url: string; code: string };
      }> = [];
      let cursor = 0,
        failed = false;
      const loadItem = async (item: Item) => {
        let module: { url: string; code: string };
        try {
          module = await untilAborted(fetchModule(item.key, stop), stop);
        } catch (error) {
          if (signal?.aborted) throw new BackendHostError("cancelled");
          // The fetcher's own refusal (busy) keeps its code: it is not the source's fault.
          if (error instanceof BackendHostError) throw error;
          if (budget.aborted)
            throw rejected(
              `npm package "${item.pkg}" did not load from esm.sh within ${Math.round(budgetMs / 1000)} s`,
            );
          const reason =
            error instanceof Error && error.message ? error.message : "failed";
          throw rejected(
            `npm package "${item.pkg}" could not be loaded from esm.sh (${reason.slice(0, 120)})`,
          );
        }
        if (
          !module ||
          typeof module.code !== "string" ||
          typeof module.url !== "string" ||
          !module.url.startsWith(ESM_ORIGIN + "/")
        )
          throw rejected(
            `npm package "${item.pkg}" could not be loaded from esm.sh`,
          );
        bytes += Buffer.byteLength(module.code);
        if (bytes > maxBytes)
          throw rejected(
            `npm packages are larger than ${Math.round(maxBytes / 1024)} KB in all (at "${item.pkg}")`,
          );
        return { item, module };
      };
      await Promise.all(
        Array.from({ length: Math.min(concurrency, wave.length) }, async () => {
          while (!failed && cursor < wave.length) {
            const index = cursor++;
            const item = wave[index]!;
            try {
              loaded[index] = await loadItem(item);
            } catch (error) {
              failed = true;
              throw error;
            }
          }
        }),
      );
      const next: Item[] = [];
      for (const { item, module } of loaded) {
        modules[item.key] = { url: module.url, code: module.code };
        lockfile[item.lockKey] = {
          url: module.url,
          integrity:
            "sha256-" +
            createHash("sha256").update(module.code).digest("base64"),
        };
        let imports: ReturnType<typeof moduleImports>;
        try {
          imports = moduleImports(module.code);
        } catch {
          throw rejected(
            `npm package "${item.pkg}" is not an ES module lambdas can bundle`,
          );
        }
        if (imports.computed)
          throw rejected(
            `npm package "${item.pkg}" imports modules computed at run time, which lambdas can't do`,
          );
        for (const specifier of imports.specifiers) {
          // The sandbox leaves these to workerd (container/bundle.mjs).
          if (BUILTIN.test(specifier) || /^\/cloudflare:/.test(specifier))
            continue;
          let target: URL;
          try {
            target = new URL(specifier, module.url);
          } catch {
            throw rejected(
              `npm package "${item.pkg}" imports "${specifier}", which lambdas can't load`,
            );
          }
          if (target.origin !== ESM_ORIGIN)
            throw rejected(
              `npm package "${item.pkg}" imports "${specifier}", which lambdas can't load`,
            );
          if (queued.has(target.href)) continue;
          queued.add(target.href);
          next.push({ key: target.href, lockKey: target.href, pkg: item.pkg });
        }
      }
      wave = next;
    }
    return { packages, modules, lockfile: sorted(lockfile) };
  }
}
