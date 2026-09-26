/**
 * THE OFFLINE FILE'S EXTRAS, LOADED ON DEMAND — the source editor and prettier, which a
 * downloaded file does not carry (scripts/build-offline.mjs builds them apart,
 * lib/offline/extras-entry is their bundle).
 *
 * Opening a file requests nothing. The first time someone opens code view the
 * file inserts ONE `<script src="<origin>/offline/extras-<hash>.js">` pinned
 * with SRI (`integrity` + `crossorigin="anonymous"`), from the origin the file
 * came from — the only address its CSP admits for a script
 * (lib/offline/file-html's artifactFileCsp). The address and hash travel in
 * the ArtifactFile (`extras`), so a saved copy keeps pointing at the same bytes.
 *
 * Offline, or when the load fails (a wrong hash, an old deploy that no longer
 * serves it), code view keeps the plain editor and says why in place
 * (RICH_EDITOR_OFFLINE), and "View formatted" is disabled (FORMATTING_OFFLINE).
 * A later attempt (the plain editor's Retry) tries again.
 */
import type { ArtifactFileExtras } from './file-format';

export const RICH_EDITOR_OFFLINE = 'The rich code editor needs a connection the first time. Using the plain editor.';
export const FORMATTING_OFFLINE = 'Formatting needs a connection.';

/** What the extras bundle leaves on `globalThis.__afbinExtras`: each module the file's bundle stubs, by name. */
export interface OfflineExtras {
  /** `lib/source-editor/codemirror`: CodeMirror, with its styles. */
  sourceEditor: unknown;
  /** `prettier/standalone`. */
  prettier: unknown;
  /** `prettier/plugins/babel` and `prettier/plugins/estree`. */
  babel: unknown;
  estree: unknown;
}

declare global {
  var __afbinExtras: OfflineExtras | undefined;
}

/** The extras' address for a file from `origin`; null when either is not something the file may load. */
export function extrasScriptUrl(origin: string, extras: ArtifactFileExtras | null | undefined): string | null {
  if (!extras) return null;
  try {
    const base = new URL(origin);
    if (base.protocol !== 'https:' && base.protocol !== 'http:') return null;
    const url = new URL(extras.path, base.origin);
    return url.origin === base.origin ? url.href : null;
  } catch {
    return null;
  }
}

export type ExtrasState = 'idle' | 'loading' | 'ready' | 'failed';

export interface ExtrasLoader {
  state(): ExtrasState;
  subscribe(listener: () => void): () => void;
  /** Resolves once the extras are on `globalThis`; rejects when they cannot be had. Safe to call again after a failure. */
  load(): Promise<void>;
}

class ExtrasUnavailable extends Error {}

export function createExtrasLoader(src: string | null, integrity: string | null, doc: Document = document): ExtrasLoader {
  let state: ExtrasState = globalThis.__afbinExtras ? 'ready' : 'idle';
  let inflight: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const set = (next: ExtrasState) => { state = next; for (const listener of listeners) listener(); };

  return {
    state: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load() {
      if (globalThis.__afbinExtras) { if (state !== 'ready') set('ready'); return Promise.resolve(); }
      if (inflight) return inflight;
      if (!src || !integrity) { set('failed'); return Promise.reject(new ExtrasUnavailable(RICH_EDITOR_OFFLINE)); }
      set('loading');
      inflight = new Promise<void>((resolve, reject) => {
        const script = doc.createElement('script');
        script.src = src;
        script.integrity = integrity;
        script.crossOrigin = 'anonymous';
        script.setAttribute('data-afbin-extras', '');
        const settle = (ok: boolean) => {
          inflight = null;
          if (ok && globalThis.__afbinExtras) { set('ready'); resolve(); return; }
          // A failed element is dropped, so a retry is a fresh request.
          script.remove();
          set('failed');
          reject(new ExtrasUnavailable(RICH_EDITOR_OFFLINE));
        };
        script.addEventListener('load', () => settle(true));
        script.addEventListener('error', () => settle(false));
        doc.head.append(script);
      });
      return inflight;
    },
  };
}
