import type { PortableDocument } from './portable-contract';
import type { HtmlJsonObject } from '@artifactbin/contracts';
export interface HtmlRuntimeConfig {
  /** Server-verified imported source; preserve its annotation invalidation lifecycle. */
  annotationObservation?: 'imported-source-v1';
  pageId: string;
  /** The saved version this page is (annotations anchor to it, presence and reads classify against it). */
  revision: string;
  /**
   * The page's live revision within `revision` (lib/artifacts current-page): served pages hold their regions' unsaved
   * live text, and (revision, live) orders them, so the frame follows live text exactly as it follows versions.
   */
  live?: number;
  /** Source-owned identities, supplied by assembly before author code runs. */
  savedNodeIds?: readonly string[];
  /** Every linked name the page declares (its dataset and default-connection links), in source order. */
  backends: readonly string[];
  /** Stored dataset links: their generated roots are flat remote fields (apollo `datasets`). */
  datasets?: readonly string[];
  /** Link name -> the dataset's ID, for invalidation notifications. */
  bindings?: Readonly<Record<string, string>>;
  /** Exact platform origin. Never a credential or a URL carrying one. */
  appOrigin?: string;
  /** Served on a anonymous owner host, unframed: reads go to this page's own host as a signed-out viewer (domain-reads). */
  domainReads?: true;
  /** Default publication destination for an unpublished file, never a published association. */
  publishOrigin?: string;
  /**
   * The files the page's publication recorded: the path a script fetches each by (relative to the page) -> where it is
   * read (the page's asset door, or an offline copy's bytes). The core's fetch maps exactly these (./page-fetch).
   */
  files?: Readonly<Record<string, string>>;
  /** The https origins the page declares in `csp-connect`: its core sends a GET to one through the page's fetch door (./page-fetch). */
  connect?: readonly string[];
  /** `@afbin/<name>` -> platform library URL, resolved server-side from the page's recorded pins. */
  libraries?: Readonly<Record<string, string>>;
  initialState?: HtmlJsonObject;
  /** The version's script fingerprint (lib/html-autofix scriptFingerprint): equal values run identical code, so a new version may be morphed in place. */
  scriptFingerprint?: string;
  /** What the core sets on <html> at load (D4): the design system, when the page has one, and the default colour mode. The viewer's own choice (`?mx-mode=`, reader messages) wins over `mode`. */
  appearance?: { designSystem?: string; mode: 'light' | 'dark' };
  /** Private preview helper transport; never an account capability. */
  localPreview?: { endpoint: string; schema: import('@artifactbin/contracts').PageSchema };
}
export interface HtmlAssemblyInput {
  html: string;
  config: HtmlRuntimeConfig;
  /** Self-contained classic JS. Runs before every authored script. */
  core: string;
  /** Hosted platform stylesheet (lib/html-systems), linked before authored styles. Omitted offline: exports inline the active system. */
  systemsHref?: string;
  /** The owner's saved design system, which wins over the page's own meta. */
  designSystem?: string | null;
  /** Fresh per-render, page-local admission for generated platform core/importmap only. */
  platformScriptNonce?: string;
  /** Ids in `html` the live composition gave blocks typed since the last save (lib/artifacts current-page): provisional, so left out of savedNodeIds (a comment never anchors to one). */
  unsavedNodeIds?: ReadonlySet<string>;
  /** Author module carried only by portable exports; hosted pages fetch its immutable asset on import. */
  apollo?: string;
  /** Reader module embedded only in self-contained portable exports. */
  reader?: string;
  /** Shared offline chrome, with the same platform components and compiled stylesheet. */
  chrome?: string;
  portableEngine?: string;
  /** `@afbin/collab`, embedded only in portable exports of a page that imports it (read-only there: no network). */
  collab?: string;
  /** `@afbin/state`, embedded in every portable export (the embedded `@afbin/apollo` imports it). */
  state?: string;
  /**
   * `@afbin/offline-sql` (./offline-sql: the SQLite engine and its wasm), embedded only in a portable export that
   * carries `offlineData`. Embed-only, so it has no RUNTIME_MODULE_PATHS address: a hosted page never loads an engine.
   */
  offlineSql?: string;
  /** The rows the downloading reader's `sql` reads through the page (lib/dataset-access offlinePageSqlData); offline exports only. */
  offlineData?: { tables: ReadonlyArray<{ schema: string; name: string; columns: ReadonlyArray<{ name: string; type: string }>; rows: ReadonlyArray<Readonly<Record<string, unknown>>> }> };
  /** Canonical source and nonsecret published identity carried by downloaded files. */
  portable?: PortableDocument;
  /** Embedded assets work without a network; connection is a separate explicit capability. */
  /** Portable HTML is emitted as UTF-8 with an early in-document encoding declaration. */
  offline?: boolean;
}

/** Code-only immutable build outputs; never page or viewer configuration. */
export interface HtmlRuntimeAssets { core:string; apollo:string; apolloPath:string; reader:string; readerPath:string; systems?:string; chrome?:string; chromePath?:string; portableEngine?:string; portableEnginePath?:string; morph?:string; morphPath?:string; regions?:string; regionsPath?:string; nativeRegions?:string; nativeRegionsPath?:string; nativeMarkdown?:string; nativeMarkdownPath?:string; collab?:string; collabPath?:string; state?:string; statePath?:string; offlineSql?:string;
 /** The document host module (lib/html-reader/host-shell) at /af/host.js: a shell's, never a page's, so it has no RUNTIME_MODULE_PATHS entry. */
 host?:string;
 /** The host comments module (solid/document/browser-host-comments) the host module imports when a shell asks for comments. */
 hostComments?:string }
/** D17: the platform runtime's flat public addresses (core: lib/html-page/core-script). No version or hash; strong ETag and `no-cache`. */
export const RUNTIME_MODULE_PATHS={apolloPath:'/af/apollo.js',readerPath:'/af/reader.js',chromePath:'/af/chrome.js',portableEnginePath:'/af/portable.js',morphPath:'/af/morph.js',regionsPath:'/af/regions.js',nativeRegionsPath:'/af/native-regions.js',nativeMarkdownPath:'/af/native-markdown.js',collabPath:'/af/collab.js',statePath:'/af/state.js'} as const;
/** `Symbol.for` key under which core records its build id for the lazy modules' skew guard (build.server). */
export const RUNTIME_BUILD_KEY='afbin.runtime-build';
