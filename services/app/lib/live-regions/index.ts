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
 * Browser: the page editor enters through native-browser; cells enter through cells. Historical editor behavior
 *           survives only as a test oracle under __tests__, never in this production entry.
 * Refusals: LiveRegionRefusal, typed by `code`.
 *
 * Documents: openRegionDoc (region-doc.ts, with forkRegionDoc inside) is the one way a region or cell document is opened.
 *
 * No storage, transport or UI: bytes in, bytes out. Every client starts from the server's state bytes.
 */
export { regionSchema, safeHref, type RegionKind } from './schema';
export { LiveRegionRefusal } from './refusal';
export { openRegionDoc, regionText } from './region-doc';
export { applyRegionRevision, createRegionState, normalizeRegionHtml, regionHtml } from './state';
export { regionMarkdown } from './markdown';
export { compactRegion } from './compaction';
export { validateRegionUpdate, validateRegionState } from './validate';
export { editableRegions, isRegionId, type PageRegion } from './page-regions';
export { applyCellRevision, cellValue, createCellState, snapshotValue } from './cells';

export {convertLegacyPage} from './legacy-migration';
