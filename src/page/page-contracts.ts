/**
 * Page source model (owner: brief D). Pure and synchronous; the same code runs
 * in the server on save and, bundled, in skills/pagegi-author/scripts/ (check.mjs).
 * Implementation lives in src/page/page-model.ts and uses parse5 with source
 * locations. There is no second HTML parser.
 *
 * Byte preservation: every transform returns the input unchanged except for
 * the platform's own edits (inserted/changed attributes, the meta block,
 * host prefixes, the core tag, platform-owned blocks). Author formatting,
 * attribute order, quoting and whitespace elsewhere are kept byte for byte.
 */
import type {
  AfJson,
  AfJsonObject,
  DesignSystemName,
  FileId,
} from "../af-contracts.ts";

/** Contents of `<script type="application/json" data-af="meta">`. Unknown keys are kept as written. */
export interface PageMeta {
  [key: string]: AfJson | undefined;
  /** Platform-owned: the page's file ID. */
  id?: FileId;
  /** Platform-owned: integer, 1 on first publish, +1 on every save. */
  version?: number;
  /** Author-owned page name. */
  name?: string;
  /**
   * Platform-owned high-water mark for node IDs: the next `n<k>` to assign.
   * It only grows, which is how removed IDs are never reused.
   */
  nextNodeId?: number;
}

/** `<link rel="af-backend" href="…/af/v1/ids/<id>" data-af-name="<name>">` */
export interface BackendLink {
  /** `data-af-name`, required, unique on the page, a GraphQL name. */
  name: string;
  href: string;
  /** Parsed from an `/af/v1/ids/<id>` href on any host; null if the href is not one. */
  id: FileId | null;
  /** 1-based line of the `<link>` start tag. */
  line: number;
}

/**
 * The core is recognised by one rule everywhere: a `<script>` whose `src`
 * path is exactly `/af/v1/core.js` on any origin (no query or fragment), or
 * an inline `<script data-af="core">`. When there are several, the first is
 * the core.
 */
export interface CoreTag {
  present: boolean;
  /** No other `<script>` precedes it in the document. */
  first: boolean;
  /** `<script data-af="core">` with inline code (a downloaded file). */
  inline: boolean;
  /** src for an external core tag; null when inline or absent. */
  src: string | null;
}

export interface ParsedPage {
  /** Null when the page has no meta block or its JSON is not an object. */
  meta: PageMeta | null;
  core: CoreTag;
  backends: BackendLink[];
  /** `data-af-design-system` on <html> in the source: the page's default design system. */
  designSystem: DesignSystemName | null;
  /** Every `data-af-id` value in document order, duplicates included. */
  nodeIds: string[];
}

export type PageProblemCode =
  | "core-missing"
  | "core-not-first"
  | "meta-invalid-json"
  | "meta-duplicate"
  /** `<script data-af-id="meta">`: the old marker; use data-af="meta". */
  | "meta-legacy-marker"
  | "duplicate-node-id"
  /** A script or stylesheet from a known CDN without an exact x.y.z version. */
  | "unpinned-cdn"
  | "backend-name-missing"
  | "backend-name-invalid"
  | "backend-name-duplicate"
  | "backend-href-invalid"
  /** A `<link data-af="design-system">` written by the author; the core adds it. */
  | "design-system-link"
  /** A warning: an author `<script type="importmap">`; Firefox honours only the first import map, the core's. */
  | "author-importmap";

export interface PageProblem {
  code: PageProblemCode;
  /** 1-based line of the offending element's start tag. */
  line: number;
  message: string;
  /** A likely mistake that doesn't make `check` fail. */
  warning?: true;
}

/** Hosts whose unversioned URLs `check` reports. */
export const KNOWN_CDN_HOSTS = [
  "cdn.jsdelivr.net",
  "unpkg.com",
  "esm.sh",
  "cdnjs.cloudflare.com",
  "cdn.skypack.dev",
] as const;

export interface NodeIdChange {
  id: string;
  tag: string;
  line: number;
}
export interface AssignOptions {
  /**
   * IDs that must never be assigned, e.g. every ID in earlier saved
   * revisions. IDs already present in the source are always avoided.
   */
  reserved?: ReadonlySet<string>;
}
export interface AssignResult {
  source: string;
  /** Newly assigned IDs in document order. Empty means the source is unchanged. */
  changes: NodeIdChange[];
  nextNodeId: number;
}

/** Inputs the server supplies when saving. */
export interface SaveContext {
  id: FileId;
  version: number;
  /** The server's own public origin, e.g. http://127.0.0.1:8787. */
  origin: string;
  /** Origins rewritten to `origin` on save, e.g. [DEFAULT_AF_ORIGIN]. */
  knownOrigins: readonly string[];
  /** `nextNodeId` stored with the previous version (0 or absent for a new page). */
  previousNextNodeId?: number;
  /** IDs from earlier revisions; never reassigned. */
  reserved?: ReadonlySet<string>;
}
export interface PreparedPage {
  source: string;
  meta: PageMeta;
  backends: BackendLink[];
  nodeIds: string[];
  /** Contents of a `data-af="state"` block, removed from the source. Seeds page state on first publish. */
  state: AfJsonObject | null;
}

export interface PortableAssets {
  /** The built core script, inlined as `<script data-af="core">`. */
  core: string;
  designSystem: DesignSystemName;
  /** The design system's CSS, put into the `data-af="design-system"` link as a data: URL. */
  designSystemCss: string;
  /** Current page state, written into a `data-af="state"` block; null writes none. */
  state: AfJsonObject | null;
  /** The server's origin, written as `data-af-server` on the core tag; absent writes none. */
  server?: string;
  /** The server's digest of this page version, written as `data-af-revision` on the core tag; absent writes none. */
  revision?: string;
}

export class PageError extends Error {
  readonly code: PageProblemCode | "malformed";
  readonly line: number;
  constructor(code: PageProblemCode | "malformed", line: number, message: string) {
    super(message);
    this.code = code;
    this.line = line;
    this.name = "PageError";
  }
}

/** Shape of src/page/page-model.ts. */
export interface PageModelModule {
  parsePage(html: string): ParsedPage;
  /** Problems an agent can introduce, sorted by line. Never throws on malformed meta JSON. */
  checkPage(html: string): PageProblem[];
  /**
   * Give every element inside <body> (not <body> itself) a `data-af-id`,
   * except <script>, <style>, <template> and anything inside a <template>.
   * Existing IDs are kept. New IDs are `n<k>` for k from the meta block's
   * `nextNodeId` (default 1), skipping any ID in use or reserved. The meta
   * block's `nextNodeId` is written back when IDs were added; a page without
   * a meta block gets one. Running it twice changes nothing the second time.
   * When two elements share an ID, the first keeps it and later ones get new IDs.
   */
  assignNodeIds(html: string, options?: AssignOptions): AssignResult;
  /** Rewrite `src`/`href` values starting with `${from}/af/v1/` to `${to}/af/v1/`. */
  rewriteHosts(html: string, from: readonly string[], to: string): string;
  /**
   * Make the core the first script in <head>: insert
   * `<script src="${origin}/af/v1/core.js"></script>` when missing, move it
   * when another script precedes it, resolve root-relative core URLs against origin, and turn an inline `data-af="core"`
   * script back into the src form.
   */
  ensureCore(html: string, origin: string): string;
  /**
   * Everything the platform does to a page on publish and save, in one call:
   * ensureCore, rewriteHosts, remove platform-owned markup (`data-af-dark` on
   * <html>, the design-system link, a `data-af="state"` block), assign node
   * IDs, and write meta `id`, `version` and `nextNodeId`
   * (max(meta, previousNextNodeId)). Throws PageError for backend link
   * problems (missing, invalid or duplicate names) and unparseable meta JSON.
   * Idempotent: preparing the result again with the same context returns it unchanged.
   */
  prepareForSave(html: string, context: SaveContext): PreparedPage;
  /**
   * A downloaded file that works on its own: the core inlined as
   * `<script data-af="core">`, `<link rel="stylesheet" data-af="design-system" href="data:text/css;base64,…">`
   * right after it, `data-af-design-system` set on <html>, a
   * `data-af="state"` block when state is given, and `data-af-server` /
   * `data-af-revision` on the core tag when given. prepareForSave of the
   * result restores the src core (dropping those attributes) and drops the
   * link and state block.
   */
  toPortable(html: string, assets: PortableAssets): string;
  /**
   * `data:text/css;base64,…` of a design system's CSS: the href of the
   * `data-af="design-system"` link in a downloaded file and in a hosted page
   * (the server sends it with the page so the first paint is already styled).
   */
  designSystemDataUrl(css: string): string;
}
