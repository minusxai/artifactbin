/** Bridge commands and events of the native HTML live morph (lib/html-runtime/live-morph, lib/html-reader/follow-version). */
/** The version command and its answers are the bridge's own (lib/html-reader/contract): the parent half follows them too. */
export {HTML_VERSION_MESSAGE,HTML_VERSION_APPLIED,HTML_VERSION_REFUSED,HTML_VERSION_REBUILT} from '../html-reader/contract';
/** Marks the frame's own read of its newest version, which is not another view of the page. */
export const LIVE_VERSION_HEADER='x-artifactbin-live-version';
/** `Symbol.for` key of the HTML a framed document loaded (core keeps it; lib/html-runtime/live-morph LOADED_SOURCE). */
export const LOADED_SOURCE_KEY='afbin.loaded-source';
