/** html-runtime's node-only entry: the runtime asset build (Babel, Tailwind) and its retention. The index stays light: browser,
 * archive and fast-lane code import it. */
export { createSourceRetention } from './asset-retention';
export type { SourceRetention } from './asset-retention-contract';
export { retainedPublicAssets } from './asset-retention.server';
export { buildHtmlAssets } from './build.server';
export { hostCommentsPath } from './host-comments-address.server';
