/**
 * lib/reader-chrome's SERVER-ONLY entry: the reader chrome the compiler draws at compile time (the outline and its
 * rail, the slide deck rail, script mounts). Never import it from browser-bundled code: the outline pulls in markdown
 * and JSX, which rt+boot must not carry (scripts/__tests__/build-islands.test.mjs). The frame's edit chunks redraw the
 * same chrome live, so they import its leaf files (outline-view, script-mount, slides) instead, which DEEP_MODULES
 * lists as entries (scripts/ci/module-graph.mjs).
 */
export { discoverOutline, hasOutline, type OutlineEntry } from './outline';
export { renderOutlineRail } from './outline-view';
export { discoverSlides, MIN_SLIDES_FOR_RAIL } from './slides';
export { isScriptComponent, MOUNT_ATTR } from './script-mount';
