import type { PortableDocument } from './portable-contract';
import type { HtmlJsonObject } from '@artifactbin/contracts';
export interface HtmlRuntimeConfig {
  pageId: string;
  revision: string;
  /** Source-owned identities, supplied by assembly before author code runs. */
  savedNodeIds?: readonly string[];
  backends: readonly string[];
  /** Namespace -> immutable linked resource ID, for backend invalidation notifications. */
  bindings?: Readonly<Record<string, string>>;
  /** Exact platform origin. Never a credential or a URL carrying one. */
  appOrigin?: string;
  /** Default publication destination for an unpublished file, never a published association. */
  publishOrigin?: string;
  initialState?: HtmlJsonObject;
  /** Private preview helper transport; never an account capability. */
  localPreview?: { endpoint: string; schema: import('@artifactbin/contracts').PageSchema };
}
export interface HtmlAssemblyInput {
  html: string;
  config: HtmlRuntimeConfig;
  /** Self-contained classic JS. Runs before every authored script. */
  core: string;
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
export interface HtmlRuntimeAssets { core:string; apollo:string; apolloPath:string; reader:string; readerPath:string; chrome?:string; chromePath?:string; portableEngine?:string; portableEnginePath?:string }
