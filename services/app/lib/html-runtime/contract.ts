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
  initialState?: HtmlJsonObject;
}
export interface HtmlAssemblyInput {
  html: string;
  config: HtmlRuntimeConfig;
  /** Self-contained classic JS. Runs before every authored script. */
  core: string;
  /** Explicit download mode disables all remote ports. */
  offline?: boolean;
}
