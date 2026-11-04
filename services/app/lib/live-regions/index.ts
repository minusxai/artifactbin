/**
 * LIVE REGIONS: the concurrent-editing core of a page's editable regions (`data-af-editable="rich" | "text"`).
 *
 * A page stays stored as HTML. While a region is edited it is one Y.Text (lines.ts) bound to ProseMirror by our own
 * binding (binding.ts); saving
 * (compaction) writes the merged tree back into the region's range of the source through canonicalizeHtmlPage.
 *
 * Server:   normalizeRegionHtml (publish stores this form), createRegionState (built once from the saved HTML),
 *           regionHtml, applyRegionRevision (a republish or agent edit, three-way from the saved version's snapshot),
 *           compactRegion (merged state → saved page, its id write-back and its snapshot).
 * Browser:  editorState (its plugins: sync, undo, id dedupe, Markdown shortcuts, keymap, clipboard), regionCommands,
 *           relativePosition / absolutePosition (Yjs relative positions, for cursors and presence).
 * Refusals: LiveRegionRefusal, typed by `code`.
 *
 * No storage, transport or UI: bytes in, bytes out. Every client starts from the server's state bytes.
 */
export { regionSchema, safeHref, type RegionKind } from './schema';
export { LiveRegionRefusal } from './refusal';
export { applyRegionRevision, createRegionState, normalizeRegionHtml, regionHtml, regionText } from './state';
export { compactRegion } from './compaction';
export { editorState, regionCommands } from './editor';
export { absolutePosition, relativePosition } from './binding';
