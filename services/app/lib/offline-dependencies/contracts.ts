/** Only an authority-checked immutable snapshot may be passed to the packer. It never fetches. */
/** Page-scoped asset URLs identify immutable bytes by origin, page, dependency and revision;
 * presentation query parameters do not change that admitted identity. Other URLs match exactly. */
interface OfflineDependency {url:string;contentType:string;bytes:Uint8Array}
export interface OfflineDependencyInput {html:string;baseUrl:string;resources:readonly OfflineDependency[]}
/** Calls process resources sequentially (one esbuild operation per call); callers must bound concurrent exports. */
/** Presentation only: canonical author source and its digest remain the caller's unchanged input. */
export interface OfflineDependencyResult {html:string;embeddedUrls:readonly string[]}
