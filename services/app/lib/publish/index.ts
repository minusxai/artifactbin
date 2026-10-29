/** The publish module's interface: what code outside lib/publish imports (rule 4, scripts/ci/module-graph.mjs). */
export { startMermaidHarvester } from './assets/mermaid-harvester';
export { WEB_ASSET_KINDS, WebAssetRefused, importForDocument, lookupWebAssets, webAssetByHash } from './assets/web-assets';
export type { WebAssetKind } from './assets/web-assets';
export { liveFrameFor } from './data/frame';
export { parseContentInput } from './document/input';
export {
  createArtifactFromBody, forkArtifact, forkDatasetPreview, forkRefusal, preflightPublication, preparePublicationBundle, refreshAssetsFor,
  replaceArtifactWithBody,
} from './publish';
export type { ForkOverrides } from './publish';
export { openDocumentEvents } from './realtime/document-events';
export { TooManyLiveChannels, subscribeChannel, subscribeToAnnotations } from './realtime/live';
