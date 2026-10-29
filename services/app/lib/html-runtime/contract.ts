import type { PortableDocument } from './portable-contract';
import type { HtmlJsonObject } from '@artifactbin/contracts';
export interface HtmlRuntimeConfig {
  /** Server-verified imported source; preserve its annotation invalidation lifecycle. */
  annotationObservation?: 'imported-source-v1';
  pageId: string;
  revision: string;
  /** Source-owned identities, supplied by assembly before author code runs. */
  savedNodeIds?: readonly string[];
  backends: readonly string[];
  /** Namespace -> immutable linked resource ID, for backend invalidation notifications. */
  bindings?: Readonly<Record<string, string>>;
  /** Exact platform origin. Never a credential or a URL carrying one. */
  appOrigin?: string;
  /** Served on a custom domain, unframed: reads go to this page's own host as a signed-out viewer (domain-reads). */
  domainReads?: true;
  /** Default publication destination for an unpublished file, never a published association. */
  publishOrigin?: string;
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
  /** Author module carried only by portable exports; hosted pages fetch its immutable asset on import. */
  apollo?: string;
  /** Reader module embedded only in self-contained portable exports. */
  reader?: string;
  /** Shared offline chrome, with the same platform components and compiled stylesheet. */
  chrome?: string;
  portableEngine?: string;
  /** Canonical source and nonsecret published identity carried by downloaded files. */
  portable?: PortableDocument;
  /** Embedded assets work without a network; connection is a separate explicit capability. */
  /** Portable HTML is emitted as UTF-8 with an early in-document encoding declaration. */
  offline?: boolean;
}

/** Code-only immutable build outputs; never page or viewer configuration. */
export interface HtmlRuntimeAssets { core:string; apollo:string; apolloPath:string; reader:string; readerPath:string; systems?:string; chrome?:string; chromePath?:string; portableEngine?:string; portableEnginePath?:string; morph?:string; morphPath?:string }
/** D17: the platform runtime's flat public addresses (core: lib/html-page/core-script). No version or hash; strong ETag and `no-cache`. */
export const RUNTIME_MODULE_PATHS={apolloPath:'/af/apollo.js',readerPath:'/af/reader.js',chromePath:'/af/chrome.js',portableEnginePath:'/af/portable.js',morphPath:'/af/morph.js'} as const;
/** `Symbol.for` key under which core records its build id for the lazy modules' skew guard (build.server). */
export const RUNTIME_BUILD_KEY='afbin.runtime-build';
