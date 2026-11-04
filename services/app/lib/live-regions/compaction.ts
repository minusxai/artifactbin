/**
 * Compaction: the merged state becomes a saved page. The region is written in normal form, spliced into its inner
 * range of the saved source (every other byte is kept) and the page goes through publish's own
 * canonicalizeHtmlPage, which gives new blocks fresh ids.
 */
import { canonicalizeHtmlPage, type HtmlIdentityLedger } from '../html-page';
import { applyEdits, attribute, parseSource, type Element } from '../html-page/html-source';
import type { Node as PMNode } from 'prosemirror-model';
import { readRegion, writeRegion } from './html';
import { LiveRegionRefusal } from './refusal';
import { ID_ATTRS, isRegionKind, regionSchema, type RegionKind } from './schema';
import { htmlSource } from './source-html';
import { encodeSnapshot, liveDocument, readDocument, writeIds } from './state';

interface RegionLocation { kind: RegionKind; start: number; end: number; inner: string; ids: ReadonlySet<string> }

/** The editable region with this `data-af-id` in a page source: its kind, inner range and the ids inside it. */
function locateRegion(source: string, regionId: string): RegionLocation {
  const document = parseSource(source);
  const element = document.elements.find((candidate) => attribute(candidate, 'data-af-id') === regionId);
  const kind = element && attribute(element, 'data-af-editable');
  const location = element?.sourceCodeLocation;
  if (!element || !isRegionKind(kind) || !location?.startTag || !location.endTag) throw new LiveRegionRefusal('region_not_found', [regionId]);
  const start = location.startTag.endOffset;
  const end = location.endTag.startOffset;
  const ids = new Set<string>();
  const inside = (candidate: Element) => { const at = candidate.sourceCodeLocation?.startOffset; return at !== undefined && at >= start && at < end; };
  for (const candidate of document.elements) { const id = attribute(candidate, 'data-af-id'); if (id && inside(candidate)) ids.add(id); }
  return { kind, start, end, inner: source.slice(start, end), ids };
}

/**
 * Strips every id the saved version does not hold inside this region (an undo can bring back an id an earlier save
 * retired; a client can write any value) and every repeat of an id (the first block in order keeps it).
 */
function keepSavedIds(kind: RegionKind, doc: PMNode, saved: ReadonlySet<string>): PMNode {
  if (kind === 'text') return doc;
  const seen = new Set<string>();
  const blocks: PMNode[] = [];
  doc.forEach((block) => {
    const attrs: Record<string, unknown> = { ...block.attrs };
    for (const name of ID_ATTRS) {
      const id = attrs[name];
      if (typeof id !== 'string') continue;
      if (!saved.has(id) || seen.has(id)) attrs[name] = null;
      else seen.add(id);
    }
    blocks.push(block.type.create(attrs, block.content, block.marks));
  });
  return regionSchema(kind).nodes.doc!.create(null, blocks);
}

interface RegionCompactionInput {
  /** The last saved page source and its identity ledger. */
  savedHtml: string;
  ledger: HtmlIdentityLedger;
  /** The `data-af-id` of the region element. */
  regionId: string;
  /** The live state. */
  state: Uint8Array;
}
interface RegionCompaction {
  /** The new page source and ledger, to save as a version. */
  html: string;
  ledger: HtmlIdentityLedger;
  /** Writes the ids publish gave new blocks into the live state. Apply it to the live state and broadcast it. */
  update: Uint8Array;
  /** The snapshot of the saved version (the state plus `update`), kept with it for later revisions. */
  snapshot: Uint8Array;
}

export function compactRegion(input: RegionCompactionInput): RegionCompaction {
  const region = locateRegion(input.savedHtml, input.regionId);
  const doc = liveDocument(input.state);
  const merged = keepSavedIds(region.kind, readDocument(region.kind, liveDocument(input.state)), region.ids);
  const spliced = applyEdits(input.savedHtml, [{ start: region.start, end: region.end, text: writeRegion(region.kind, merged) }]);
  const page = canonicalizeHtmlPage(spliced, { previousHtml: input.savedHtml, ledger: input.ledger });
  const saved = readRegion(region.kind, htmlSource(locateRegion(page.html, input.regionId).inner), 'strip');
  const ids: Record<string, string | null>[] = [];
  saved.forEach((block) => { ids.push(Object.fromEntries(ID_ATTRS.map((name) => [name, block.attrs[name] ?? null]))); });
  const update = writeIds(region.kind, doc, ids);
  return { html: page.html, ledger: page.ledger, update, snapshot: encodeSnapshot(doc) };
}
