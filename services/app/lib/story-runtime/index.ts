/**
 * lib/story-runtime's SERVER-ONLY entry: the reader chrome the compiler draws at compile time (the outline and its
 * rail, the slide deck rail, script mounts). Never import it from browser-bundled code: the outline pulls in markdown
 * and JSX, which rt+boot must not carry (scripts/__tests__/build-islands.test.mjs). The module's other doors are
 * contract, story-fragment, data and the four lazy edit/ chunks; browser-bundled code also imports the leaf files
 * DEEP_MODULES lists (scripts/ci/module-graph.mjs).
 */
export { discoverOutline, hasOutline, type OutlineEntry } from './outline';
export { renderOutlineRail } from './outline-view';
export { discoverSlides, MIN_SLIDES_FOR_RAIL } from './slides';
export { isScriptComponent, MOUNT_ATTR } from './script-mount';
