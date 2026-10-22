/**
 * How the core (src/browser/core/core.ts) and the hosted runner bridge
 * (src/browser/bridge.js) meet inside the page's realm. Both live on the
 * page's own (runner) origin; neither ever holds an account token. The bridge
 * runs first in a hosted page and registers a CoreHost under
 * `Symbol.for(AF_HOST_KEY)`; a page opened on its own has none, so the core
 * falls back to a store kept in browser storage (src/browser/core/standalone.ts) and an offline remote.
 *
 * A downloaded file is the other way round: the core runs first (inline), and
 * the platform runtime it loads from the file's server arrives later. Its
 * bridge then calls `attach` on the core's `Symbol.for(AF_CORE_KEY)` object
 * with the same CoreHost shape, and the core switches its viewer appearance
 * and remote port to it and hands back its running state store.
 */
import type { AfJsonObject } from "../../af-contracts.ts";
import type { AfClient, RemotePort, StatePort } from "../../apollo/apollo-contracts.ts";
import type { DocumentNode } from "graphql";

/** `globalThis[Symbol.for(AF_HOST_KEY)]`: set by the hosted bridge before the core runs. */
export const AF_HOST_KEY = "afbin.host";
/** `globalThis[Symbol.for(AF_CORE_KEY)]`: what the `@afbin/apollo` blob module reads. */
export const AF_CORE_KEY = "afbin.core";
/** Where a standalone page remembers the viewer's own picks (never in the page). */
export const AF_VIEWER_STORAGE_KEY = "af:viewer";

/** The viewer's own choices; null means "not chosen". */
export interface ViewerAppearance {
  designSystem: string | null;
  dark: boolean | null;
}

export interface CoreHost {
  viewer(): ViewerAppearance;
  subscribeViewer(listener: (viewer: ViewerAppearance) => void): () => void;
  /**
   * The viewer's own local state for this page, kept in their browser and
   * never sent to other viewers; null when the bridge has no page (the core
   * then keeps state in memory). Called at most once, after the page is
   * parsed; `seed` is the page's `data-af="state"` block (or {}), used when
   * the platform sent no published seed.
   */
  state(seed: AfJsonObject): StatePort | null;
  /** One RemotePort per page: POST /api/files/:id/graphql through the platform frame. */
  remote(): RemotePort;
  /** Internal migrated person-card image port: exact page-bound URL, no arbitrary fetch. */
  image?(url:string,signal?:AbortSignal):Promise<Blob>;
  /** Internal fixed-Import binary attachment port; never a credentialed fetch API. */
  datasetAttachment?: import("../dataset-attachment-bridge-contracts.ts").AttachmentPort;
}

/** What the core gives a platform runtime that attaches to a downloaded file. */
export interface LocalAttachment {
  /** The viewer's local state, the store the page's client already uses. */
  state: StatePort;
  /** Save the page as a file with its current state (what the "Download page" control did). */
  save(): void;
  /** `data-af-server` and `data-af-revision` from the core tag. */
  server: string;
  revision: string | null;
}

/** Exposed by the core for the `@afbin/apollo` module: `export const client = core.client()`. */
export interface CoreModules {
  gql(strings: TemplateStringsArray, ...fragments: DocumentNode[]): DocumentNode;
  /** Builds the page's one client on first call, once the page is parsed. */
  client(): AfClient;
  /**
   * Only in a downloaded file that names its server: a platform runtime loaded
   * from that server attaches its host once. The core then takes the host's
   * viewer appearance, remote and internal attachment ports (also for a client built earlier) and
   * removes its own download control. A second call throws.
   */
  attach?(host: Pick<CoreHost, "viewer" | "subscribeViewer" | "remote" | "datasetAttachment">): LocalAttachment;
}
