/** html-runtime's node-only entry: the runtime asset build (Babel, Tailwind) and its retention. The index stays light: browser,
 * archive and fast-lane code import it. */
export { createSourceRetention } from './asset-retention';
export type { SourceRetention } from './asset-retention-contract';
export { retainedPublicAssets } from './asset-retention.server';
export { buildHtmlAssets } from './build.server';
export { supplyHtmlAssets, type HtmlAssetsSupply } from './assets-supply.server';
export { hostCommentsPath } from './host-comments-address.server';
/** Whether a served page already carries the source annotations' observation (the frame's own, ./bridge). */
export { hasImportedSourceObservation } from './bridge/imported-observation';
export { runtimeModuleAddresses, runtimeModuleFile } from './runtime-addresses.server';
export { RUNTIME_MODULE_PATHS } from './contract';
