import type { DocumentState, Snapshot } from "../contracts.ts";
/** A document surface may display history, but no historical operation publishes. */
export interface PublicationGate {
  readonly epoch: number;
  readonly active: boolean;
  suspend(): void;
  resume(): void;
  accepts(epoch: number): boolean;
  assert(epoch: number): void;
}
/** Hides placement, runner handshakes and nonexecuting historical presentation. */
export interface AppSurface {
  mount(
    source: string,
    snapshot: Snapshot | null,
    revision: string,
    history?: boolean,
  ): void;
  send(message: Record<string, unknown>): void;
  accepts(event: MessageEvent): boolean;
}
export interface PlacementOptions {
  /** A downloaded file: the page is this document, and the bridge is installed in its realm. */
  local?: boolean;
  shell: { runner: string } | null;
  frame: HTMLIFrameElement;
  historyFrame: HTMLIFrameElement;
  /** What the page's core needs for the viewer's own local state; read on every live mount. */
  localState(): LocalStateBoot;
  /** The viewer's own appearance picks, passed to the page's core. */
  viewer(): import("./core/host-contracts.ts").ViewerAppearance;
  bridge: string;
  /** The page's own design system, inlined before the core so the first paint is styled; null adds nothing. */
  designSystem: HostedDesignSystem | null;
  /** A design system's CSS for a saved view, or null when it cannot be had; the view then shows unstyled by it. */
  designSystemCss?(name: import("../af-contracts.ts").DesignSystemName): Promise<string | null>;
}
/**
 * The design system the server sends with a hosted page: the runner puts
 * `<link rel="stylesheet" data-af="design-system" href="data:…">` before the
 * core, which then adds no network stylesheet for the same system.
 */
export interface HostedDesignSystem {
  name: string;
  /** `data:text/css;base64,…` */
  href: string;
}
/**
 * Boot data for the viewer's local state in a hosted page (the runner bridge
 * keeps it in browser storage keyed by `page`): the published page's
 * `data-af="state"` contents to start from on first open, and state loaded
 * from the address (`#af-state=`), which replaces the viewer's copy once.
 */
export interface LocalStateBoot {
  page: string;
  seed: import("../af-contracts.ts").AfJsonObject | null;
  load: import("../af-contracts.ts").AfJsonObject | null;
}
/** Source remains immutable even while the app mutates its entire DOM. */
export interface PortableDocumentSession {
  source: string;
  state: DocumentState;
  /** The published page's starting local state (its `data-af="state"` block), or null. */
  seed: import("../af-contracts.ts").AfJsonObject | null;
  /** State from the address's `#af-state=` (already removed from the address bar), or null. */
  load: import("../af-contracts.ts").AfJsonObject | null;
  shell: { runner: string } | null;
  hosted: {
    token: string | null;
    username: string | null;
    home: string;
    permissions: import("../contracts.ts").FilePermissions;
    path: string;
    /** The server's number for the open page version. */
    version?: number;
  } | null;
  preview: { token: string; etag: string } | null;
  /** The page's own design system's CSS, sent with the page (null when the server sent none). */
  designSystem: HostedDesignSystem | null;
  /** A downloaded file opened on its own, running the runtime loaded from its server. */
  local: boolean;
  /** The file's identity, from its meta block and core tag; only when local. */
  page?: LocalPage;
}
/** What a downloaded file knows about itself (see AF_SERVER_ATTRIBUTE in src/af-contracts.ts). */
export interface LocalPage {
  server: string;
  id: string;
  version: number;
  /** The server's digest of this version, or the version number as text when the file has none. */
  revision: string;
}
