/** The viz module's interface: what code outside lib/viz imports (rule 4, scripts/ci/module-graph.mjs). */
export { BASEMAP_ALLOWED, BASEMAP_UPSTREAM, BASEMAP_WORKER_URL } from './basemap';
export { dailySeries } from './daily-series';
export { renderSparklineSvg } from './sparkline';
export { tileUpstreamUrl } from './tiles';
