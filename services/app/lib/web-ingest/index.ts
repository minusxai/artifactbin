/** The web-ingest module's interface: what code outside lib/web-ingest imports (rule 4, scripts/ci/module-graph.mjs). */
export { fetchBrowserFontResource } from './browser-fonts';
export { fetchWebResource, webIngestAllowsHttp } from './fetch';
export { WebIngestError, isForbiddenIp } from './guard';
export { sniffAssetType, sniffFontType, sniffImageType } from './sniff';
