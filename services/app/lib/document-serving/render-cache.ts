/**
 * THE RENDER CACHE: finished document responses for anonymous readers — the app page's shell and the
 * document frame (/raw on the document's own origin) — so a popular public page is rendered once per
 * version rather than once per view.
 *
 * What it holds is bytes only: never a decision. Every request still asks the access question of the row
 * as it is now (a column-limited read) BEFORE it may look here, so a revoked or private document is never
 * answered from memory; a new version, edit or metadata change is a new key, never the old body.
 *
 * Bounded by bytes (least recently used goes first) and by a per-entry lifetime, so what the key does not
 * name (a like count in the shell, a referenced image's version in the frame) is at most that old.
 *
 * A frame carries a per-response CSP nonce: it is stored as `NONCE_PLACEHOLDER` and every response gets a
 * fresh one (`withFreshNonce`). That body is stored uncompressed: a brotli stream cannot have bytes near its
 * start replaced, and per-response brotli of a frame costs ~1 ms against the ~50 ms render this saves.
 */
import {createHash, randomBytes, randomUUID} from 'node:crypto';

interface RenderCacheClock { now(): number }
export interface CachedRender {
  status: number;
  headers: ReadonlyArray<readonly [string, string]>;
  body: Uint8Array<ArrayBuffer>;
}
interface Entry { value: CachedRender; bytes: number; expires: number }
export interface RenderCacheOptions { maxBytes: number; clock?: RenderCacheClock }
export interface RenderCache {
  get(key: string): CachedRender | undefined;
  set(key: string, value: CachedRender, ttlMs: number): void;
  clear(): void;
  readonly bytes: number;
  readonly size: number;
}

export function createRenderCache({maxBytes, clock = Date}: RenderCacheOptions): RenderCache {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Invalid render cache bound');
  // Map order is recency order: a hit is re-inserted at the end, eviction takes the front.
  const entries = new Map<string, Entry>();
  let total = 0;
  const drop = (key: string) => {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    total -= entry.bytes;
  };
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expires <= clock.now()) { drop(key); return undefined; }
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value, ttlMs) {
      const bytes = value.body.byteLength + key.length + value.headers.reduce((n, [name, v]) => n + name.length + v.length, 0);
      drop(key);
      // One body larger than the whole bound is served, never retained.
      if (bytes > maxBytes || ttlMs <= 0) return;
      entries.set(key, {value, bytes, expires: clock.now() + ttlMs});
      total += bytes;
      for (const oldest of entries.keys()) {
        if (total <= maxBytes) break;
        drop(oldest);
      }
    },
    clear() { entries.clear(); total = 0; },
    get bytes() { return total; },
    get size() { return entries.size; },
  };
}

/** A stable key from the facts that determine a body; each fact is named, so two shapes never collide. */
export function renderKey(facts: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(facts)).digest('base64url');
}

/** The process's shared cache: 64 MB of rendered pages. */
const RENDER_CACHE_BYTES = 64 * 1024 * 1024;
/** The shell inlines like and comment counts the key does not name: they stay this fresh. */
export const SHELL_TTL_MS = 30_000;
/** The frame names its version; only referenced assets' versions and the canonical address can drift. */
export const FRAME_TTL_MS = 60_000;
export const renderCache: RenderCache = createRenderCache({maxBytes: RENDER_CACHE_BYTES});
/** Test hook. */
export function resetRenderCache(): void { renderCache.clear(); }

/**
 * The nonce a cached frame is rendered with: random per process (no author can write it into a page ahead of
 * time) and of the platform nonce's own shape, so it passes the same validation the real one does.
 */
export const NONCE_PLACEHOLDER = randomBytes(16).toString('hex');
/** A cached frame's body with this response's own nonce. */
export function withFreshNonce(template: string): string {
  return template.replaceAll(NONCE_PLACEHOLDER, randomUUID().replaceAll('-', ''));
}

/** Who may be served from the cache: a reader with no account, no token and no carried grants. */
export function anonymousReader(actor: {userId?: string | null; tokenId?: string | null}, carried?: Record<string, unknown> | null): boolean {
  return !actor.userId && !actor.tokenId && !(carried && Object.keys(carried).length);
}
