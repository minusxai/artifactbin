/** html-runtime's node-only entry: the runtime asset build (Babel, Tailwind) and its retention. The index stays light: browser,
 * archive and fast-lane code import it. */
export { createRuntimeAssetRetention } from './asset-retention';
export type { RuntimeAssetRetention } from './asset-retention-contract';
export { retainedRuntimeAssets } from './asset-retention.server';
export { buildHtmlAssets } from './build.server';
