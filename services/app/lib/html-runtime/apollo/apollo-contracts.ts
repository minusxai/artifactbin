/** Viewer state storage and the supported SQL transport; no query-language client. */
import type {HtmlJson as AfJson, HtmlJsonObject as AfJsonObject} from '@artifactbin/contracts';
/** A write against the document: replace top-level fields if they still hold the expected values. */
export interface StoreWrite {
  /** Top-level field → value it must still have (undefined: must be absent). */
  expected: Record<string, AfJson | undefined>;
  /** Top-level field → new value (undefined: remove the field). */
  next: Record<string, AfJson | undefined>;
  /** True: the document must also have no top-level field outside `expected` (one added meanwhile conflicts). */
  exact?: boolean;
}
export type StoreReceipt =
  | { status: "committed"; document: AfJsonObject }
  | { status: "conflict"; document: AfJsonObject }
  | { status: "rejected"; document: AfJsonObject; error: string };

/**
 * Where the viewer's document lives: browser storage keyed by the page
 * (src/browser/core/standalone.ts persistentStore), or memory
 * (createLocalStore). Listeners run after every change to the document,
 * including a change made in another tab of the same viewer.
 */
export interface StatePort {
  read(): AfJsonObject;
  subscribe(listener: (document: AfJsonObject) => void): () => void;
  write(change: StoreWrite): Promise<StoreReceipt>;
}

export class RemoteUnreachable extends Error {
  constructor(message = 'offline') { super(message); this.name = 'RemoteUnreachable'; }
}
export type QueryInvalidation = 'data' | 'authority';
export interface RemotePort {
  subscribe?(listener:(reason?:QueryInvalidation)=>void):()=>void;
  online():boolean;
  execute(request:{sql?:string;query?:string;params:Record<string,string|number|boolean|null>;idempotencyKey?:string}):Promise<unknown>;
}

/** `#af-state=<base64url of the local-state JSON>` on a page address loads that state for the viewer. */
export const AF_STATE_FRAGMENT = "af-state";
/** Largest `#af-state` document, in bytes of decoded JSON (256 KB). */
export const AF_STATE_URL_LIMIT = 256 * 1024;

/** What a page address's fragment says about local state. */
export interface StateFragment {
  /** `#af-state=` was present. */
  found: boolean;
  /** The decoded state, or null when absent or unusable. */
  state: AfJsonObject | null;
  /** Why a present `#af-state` was ignored (malformed, too large, not storable). */
  error: string | null;
  /** The fragment without `af-state`, with its leading "#", or "" when nothing is left. */
  rest: string;
}
