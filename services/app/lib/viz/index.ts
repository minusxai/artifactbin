/** The viz module's interface: what code outside lib/viz imports (rule 4, scripts/ci/module-graph.mjs). */
export { BASEMAP_ALLOWED, BASEMAP_UPSTREAM } from './basemap';
export { dailySeries } from './daily-series';
export type { ColorScale, Feature, MapViewState, Row } from './deck-engine-core';
export { renderSparklineSvg } from './sparkline';
export { tileUpstreamUrl } from './tiles';
export { VIZ_TEMPLATES, getTemplate } from './viz-templates';
