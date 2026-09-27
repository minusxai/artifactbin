/**
 * Where the in-frame runtime lives — the URLs, resolved from the build's own
 * manifest rather than hard-coded.
 *
 * The runtime is the largest thing a document loads (~1.3 MB) and the chart
 * chunk behind it another ~830 KB. Their bytes never change within a build, so
 * they want `immutable` caching (server/app.ts) — and `immutable` is only safe on
 * a URL that CHANGES when the bytes do, or a deploy strands every returning
 * reader on a runtime whose lazy imports name chunk hashes the new build no
 * longer serves. So the build content-hashes the entry, exactly as its chunks
 * always were, and records the names here.
 *
 * It records the LAZY chunks too, for a different reason: a document that draws
 * a chart cannot discover that URL until the entry has downloaded and parsed,
 * which puts it third in a chain of three round trips. Named here, the document
 * can ask for it in its own head instead (lib/story/document.ts).
 *
 * Read once, at first use: a build artifact cannot change under a running
 * server, and the serving route must not touch the filesystem per request.
 *
 * There is no fallback to a fixed name on purpose. A missing manifest means the
 * runtime was never built, and the alternative — serving a document that points
 * at an entry which 404s — is a blank, unhydrated page with nothing in the log
 * to say why.
 */
import { readFileSync } from 'fs';
import { IS_DEV } from '@/lib/config';
import path from 'path';

/** Written by scripts/build-story-runtime.mjs next to the bundle it describes. */
const storyRuntimeManifest = (): string => path.join(process.cwd(), 'public/story/manifest.json');

interface StoryRuntimeManifest {
  /** Absolute path of the ES module entry, e.g. `/story/entry-4RXVQ2NA.js`. */
  entry: string;
  /**
   * The reading-position script, which EVERY document loads — including the
   * ones that hydrate nothing (lib/story-runtime/anchor-entry). Null for a
   * manifest written before it existed.
   */
  anchor: string | null;
  /**
   * The COMMENT layer (lib/story-runtime/comment-entry) — the frame half of
   * annotating, without the hydration runtime around it. What a commenter on a
   * document of pure prose needs and nothing more. Null for a manifest written
   * before it existed.
   */
  comment: string | null;
  /** Chunks the entry reaches only through `import()` — today, the chart bundle. */
  lazy: string[];
  /** The page's SQLite engine wasm (StoryIslandData.sqliteWasm). Null for a manifest written before it existed. */
  sqlite: string | null;
  /** The entry's STATIC chunks (not the entry itself), preloaded with it. Empty for an older manifest. */
  entryDeps: string[];
  /** Each `lazy` chunk's static chunks, keyed by that chunk. Empty for an older manifest. */
  lazyDeps: Record<string, string[]>;
  /**
   * Per Mermaid diagram kind (lib/story-ui/mermaid-source), the full static
   * closure it loads: the engine, the diagram's module, its layout engine.
   * Empty for an older manifest.
   */
  mermaid: Record<string, string[]>;
  /**
   * Per kit chunk (lib/story-ui/kit-chunks), the chunk and its full static
   * closure — what a document drawing it preloads, and the runtime awaits
   * before it hydrates. Empty for an older manifest.
   */
  kit: Record<string, string[]>;
}

let cached: StoryRuntimeManifest | null = null;

/**
 * The manifest, read at most once.
 *
 * `file` is a test seam; production always reads the built one. Validated
 * rather than trusted: an `entry` that is not a path under `/story/` would put
 * an arbitrary URL into every document's `<script src>`, and this file is
 * generated — a shape change should stop the server, not reach a reader.
 */
export function readStoryRuntimeManifest(file: string = storyRuntimeManifest()): StoryRuntimeManifest {
  // Cached for the life of the process, because a build artifact cannot change
  // under a running server — except in DEVELOPMENT, where rebuilding the
  // runtime is a thing people do all day. The names are content-hashed, so a
  // stale cache there serves a document pointing at an entry that 404s: no
  // hydration, no charts, no anchor, and nothing in the log to say why.
  if (cached && !IS_DEV) return cached;
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    throw new Error(`story runtime manifest missing at ${file} — run \`npm run build:runtime\``);
  }
  const parsed = JSON.parse(raw) as Partial<StoryRuntimeManifest>;
  const local = (v: unknown): v is string => typeof v === 'string' && v.startsWith('/story/');
  if (!local(parsed.entry)) throw new Error(`story runtime manifest is malformed: ${raw.slice(0, 200)}`);
  // The anchor script is ADDITIVE: a manifest from before it existed still
  // describes a runnable runtime, and a document that cannot keep the reader's
  // place is a smaller failure than one that does not hydrate at all. The build
  // asserts the file it names is really there, so a real build always has one.
  const lazy = Array.isArray(parsed.lazy) ? parsed.lazy.filter(local) : [];
  // The closures are ADDITIVE preload hints, validated like every other name:
  // anything not a path under /story/ is dropped, never served.
  const urls = (v: unknown): string[] => Array.isArray(v) ? v.filter(local) : [];
  const record = (v: unknown, key: (k: string) => boolean): Record<string, string[]> =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).filter(([k, list]) => key(k) && Array.isArray(list)).map(([k, list]) => [k, urls(list)]))
      : {};
  cached = {
    entry: parsed.entry,
    anchor: local(parsed.anchor) ? parsed.anchor : null,
    // ADDITIVE like `anchor`: without it a commenter simply falls back to the
    // full runtime (lib/story/document), which is what they got before.
    comment: local(parsed.comment) ? parsed.comment : null,
    lazy,
    // ADDITIVE too: without it a page runs nothing itself, as before.
    sqlite: local(parsed.sqlite) ? parsed.sqlite : null,
    entryDeps: urls(parsed.entryDeps),
    lazyDeps: record(parsed.lazyDeps, (k) => lazy.includes(k)),
    mermaid: record(parsed.mermaid, (k) => /^[\w-]+$/.test(k)),
    kit: record(parsed.kit, (k) => /^[\w-]+$/.test(k)),
  };
  return cached;
}

/**
 * The `src` of the hydration runtime for this build. Throws if there isn't one
 * — for callers that need the answer to exist.
 */
export const storyRuntimeSrc = (): string => readStoryRuntimeManifest().entry;

let warned = false;

/**
 * The same assets, for the SERVING path — which must never fail a readable
 * document over a build artifact.
 *
 * A route that let this throw would answer 500 for EVERY document, prose
 * included, when prose needs no runtime at all. A missing or broken runtime
 * bundle must never take the page down with it: without a runtime the document
 * is still server-rendered, readable and indexable — it simply does not
 * hydrate.
 *
 * The loud failure belongs earlier, where it can stop a deploy instead of a
 * reader: the build asserts the files it names exist
 * (scripts/build-story-runtime.mjs), mirroring the `test -f libduckdb.so` guard
 * that exists because a partial trace took every route down once already.
 */
export function storyRuntimeAssets(file?: string): Omit<StoryRuntimeManifest, 'entry'> & { entry: string | null } {
  try {
    return readStoryRuntimeManifest(file);
  } catch (err) {
    if (!warned) {
      warned = true;
      console.error('[story] serving documents WITHOUT the hydration runtime:', err);
    }
    return { entry: null, anchor: null, comment: null, lazy: [], sqlite: null, entryDeps: [], lazyDeps: {}, mermaid: {}, kit: {} };
  }
}

/** Test seam: forget the cached read so a fixture manifest can be picked up. */
export function resetStoryRuntimeManifest(): void {
  cached = null;
  warned = false;
}
