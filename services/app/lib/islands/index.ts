/**
 * THE ISLAND RUNTIME, as server code sees it: the names the page assembler, the compiler, the chart
 * drawer, the document frame and the class generator share with the browser islands — the page-data
 * shape and its attributes, the kit's compile-time class recipes, and the server drawing's classes.
 * Constants, types and pure functions only; nothing here touches the DOM. Every other file of this
 * module is browser-side (the Solid bridge, the kit, the portals, the live morph). Browser-bundled
 * code imports the leaf files directly: the island and app bundlers cannot drop the rest of a barrel.
 * Who may import what is checked by scripts/ci/module-graph.mjs (ISLANDS_BROWSER_IMPORTERS,
 * ISLANDS_BROWSER_LEAVES).
 */
export type { IslandPageData } from './contract';
export { LIVE_DIRECT_ATTR, STORY_FRAMED_ATTR } from './contract';
export { cn, FAMILIES, RECIPES } from './kit/recipes';
export { peopleClasses } from './kit/recipes/people';
export { DRAWING_CLASS } from './chart';
