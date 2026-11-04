/**
 * The editable regions a saved page declares: every element with `data-af-editable="rich" | "text"` and a
 * `data-af-id`, with its inner HTML. Server-side (parse5), like compaction.
 */
import { attribute, parseSource } from '../html-page/html-source';
import { isNodeId, isRegionKind, type RegionKind } from './schema';

export interface PageRegion { id: string; kind: RegionKind; inner: string }

/** Sibling routes under /regions/ that a region id must never shadow. */
const ROUTE_NAMES = new Set(['flush', 'stream']);

/** A region id in canonicalizeHtmlPage's id grammar that no sibling region route owns. */
export const isRegionId = (value: unknown): value is string => isNodeId(value) && !ROUTE_NAMES.has(value);

export function editableRegions(source: string): PageRegion[] {
  const regions: PageRegion[] = [];
  for (const element of parseSource(source).elements) {
    const kind = attribute(element, 'data-af-editable'), id = attribute(element, 'data-af-id');
    const location = element.sourceCodeLocation;
    if (!isRegionKind(kind) || !isRegionId(id) || !location?.startTag || !location.endTag) continue;
    regions.push({ id, kind, inner: source.slice(location.startTag.endOffset, location.endTag.startOffset) });
  }
  return regions;
}
