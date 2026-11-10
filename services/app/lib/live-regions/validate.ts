/**
 * THE SERVER'S CHECK OF AN INCOMING UPDATE, before it is stored or relayed: a pure function of the region's state and
 * the update's bytes. Every refusal is a typed LiveRegionRefusal with the contract's code (refusal.ts).
 *
 * What an update may hold, from the session's own client id only (another id is `foreign_client`: a forged id at a
 * future clock would silently drop the real client's later edits):
 *  - Items of the region's ONE root text (`region`), never another root, a map key or a nested type
 *    (`outside_region`), holding text, formats or deleted content and nothing else (`unsupported_content`);
 *    GC structs (content its own gc-on client collected before sending) carry nothing and are accepted.
 *  - Formats with the keys lines.ts writes (marks on characters, block attributes on a line's "\n") and the values
 *    its reader would keep: marks `true`, a safe `link`, a `level` 0–6, a known `list`, a `depth` within MAX_DEPTH,
 *    flags `true`, ids in canonicalizeHtmlPage's grammar; `null` removes. A plain-text region holds no format.
 *  - A block attribute this update sets on a character that is not a line end is refused when the update itself
 *    shows the character: one it inserts, one of its own earlier ones, or the one it formatted from (the format's
 *    right origin). A peer's character that concurrency slid into the range is the peer's, not this update's: the
 *    reader ignores block attributes off a line end, so it is tolerated rather than refused.
 *  - Nothing it depends on missing: its first struct continues the client's clock, every origin and every delete
 *    names something the state (or the update) holds; otherwise `out_of_order`, with the state's vector.
 *  - At most REGION_UPDATE_MAX_BYTES, and the merged text at most REGION_TEXT_MAX_UNITS (`too_large`).
 *
 * An update with no new struct and no new delete is a retry: `duplicate`, nothing applied.
 */
import * as Y from 'yjs';
import { validateNativeTree } from './native-state';
import { NATIVE_ROOT, nativeSchema } from './native-schema';
import { REGION_TEXT_MAX_UNITS, REGION_UPDATE_MAX_BYTES } from '@artifactbin/contracts';
import { keysOf } from './lines';
import { LiveRegionRefusal } from './refusal';
import { isNodeId, MAX_DEPTH, safeHref, type RegionKind } from './schema';
import { openRegionDoc, REGION_ROOT, regionText } from './region-doc';

const CHAR_KEYS = new Set(keysOf('x'));
const BLOCK_KEYS = new Set(keysOf('\n'));

const isInteger = (value: unknown, min: number, max: number) => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
const FORMAT_VALUES: Record<string, (value: unknown) => boolean> = {
  checked: (value) => typeof value === "boolean",
  bold: (value) => value === true,
  italic: (value) => value === true,
  code: (value) => value === true,
  link: (value) => typeof value === 'string' && safeHref(value) === value,
  level: (value) => isInteger(value, 0, 6),
  list: (value) => value === 'bullet' || value === 'ordered',
  depth: (value) => isInteger(value, 0, MAX_DEPTH),
  quote: (value) => value === true,
  codeBlock: (value) => value === true,
  codeContinues: (value) => value === true,
  rule: (value) => value === true,
  afId: isNodeId,
  itemId: isNodeId,
  listId: isNodeId,
  quoteId: isNodeId,
};

export interface RegionUpdateCheck {
  /** Nothing new: a retry of what the state already holds. */
  duplicate: boolean;
  /** The state with the update applied (the same document when one was passed in). */
  doc: Y.Doc;
}

/** Yjs's delete set, as decodeUpdate answers it. */
type DeleteSet = { clients: Map<number, { clock: number; len: number }[]> };

const unsupported = (detail: string) => new LiveRegionRefusal('unsupported_content', [detail]);

/**
 * Checks `update` against the region's state and applies it. `state` is the merged state's bytes, or a live document
 * (gc off) the caller owns: it is updated in place, and after a refusal it must be discarded (some checks run on the
 * applied update).
 */
export function validateRegionUpdate(kind: RegionKind, state: Uint8Array | Y.Doc, update: Uint8Array, clientId: number): RegionUpdateCheck {
  if (update.byteLength > REGION_UPDATE_MAX_BYTES) throw new LiveRegionRefusal('too_large', [`${update.byteLength} bytes`]);
  let decoded: { structs: (Y.Item | Y.GC | Y.Skip)[]; ds: DeleteSet };
  try { decoded = Y.decodeUpdate(update) as typeof decoded; } catch { throw unsupported('undecodable update'); }
  const doc = state instanceof Y.Doc ? state : openRegionDoc(state, { kind });
  const expectedRoot = kind === 'rich-native-v1' ? NATIVE_ROOT : REGION_ROOT;
  if ([...doc.share.keys()].some(root => root !== expectedRoot)) throw new LiveRegionRefusal('outside_region');
  const known = Y.decodeStateVector(Y.encodeStateVector(doc));
  const outOfOrder = (detail: string) => new LiveRegionRefusal('out_of_order', [detail], Y.encodeStateVector(doc));
  const ownBefore = known.get(clientId) ?? 0;

  // Structs: whose they are and whether they continue the client's clock, then where they live and what they hold.
  let ownEnd = ownBefore;
  for (const struct of decoded.structs) {
    if (struct.id.client !== clientId) throw new LiveRegionRefusal('foreign_client', [String(struct.id.client)]);
    if (struct instanceof Y.Skip) throw outOfOrder('a hole in the update');
    if (struct.id.clock > ownEnd) throw outOfOrder(`clock ${struct.id.clock} after ${ownEnd}`);
    ownEnd = Math.max(ownEnd, struct.id.clock + struct.length);
  }
  const holds = (id: Y.ID) => id.clock < (known.get(id.client) ?? 0) || (id.client === clientId && id.clock < ownEnd);
  const formats: Y.Item[] = [];
  for (const struct of decoded.structs) {
    if (struct instanceof Y.GC) continue;
    const item = struct as Y.Item;
    const parent = item.parent as unknown;
    if (kind === 'rich-native-v1') {
      if (typeof parent === 'string' && parent !== NATIVE_ROOT) throw new LiveRegionRefusal('outside_region');
      if (parent instanceof Y.ID && !holds(parent)) throw outOfOrder('unknown native parent');
      const content = item.content;
      if (content instanceof Y.ContentType) {
        const type = content.type;
        if (!(type instanceof Y.XmlText) && (!(type instanceof Y.XmlElement) || !nativeSchema.nodes[type.nodeName] || ['doc','text'].includes(type.nodeName))) throw unsupported('native type');
      } else if (!(content instanceof Y.ContentString) && !(content instanceof Y.ContentFormat) && !(content instanceof Y.ContentAny) && !(content instanceof Y.ContentDeleted)) throw unsupported('native content');
      for (const origin of [item.origin, item.rightOrigin]) if (origin && !holds(origin)) throw outOfOrder('unknown native origin');
      continue;
    }
    if (item.parentSub !== null || (parent !== null && parent !== REGION_ROOT)) throw new LiveRegionRefusal('outside_region', [item.parentSub ?? (typeof parent === 'string' ? parent : 'a nested type')]);
    const { content } = item;
    if (content instanceof Y.ContentFormat) formats.push(item);
    else if (!(content instanceof Y.ContentString) && !(content instanceof Y.ContentDeleted)) throw unsupported(content.constructor.name);
    for (const origin of [item.origin, item.rightOrigin]) if (origin && !holds(origin)) throw outOfOrder(`unknown origin ${origin.client}:${origin.clock}`);
  }
  for (const item of formats) {
    const { key, value } = item.content as Y.ContentFormat;
    if (value === null) continue;
    if (kind === 'text') throw unsupported(`format ${key} in a plain-text region`);
    if (!CHAR_KEYS.has(key) && !BLOCK_KEYS.has(key)) throw unsupported(`format ${key}`);
    if (!FORMAT_VALUES[key]!(value)) throw unsupported(`${key} ${JSON.stringify(value)}`);
  }

  // Deletes: of anything the state or the update holds; new ones make the update more than a retry.
  let newDeletes = false;
  for (const [client, ranges] of decoded.ds.clients) {
    for (const { clock, len } of ranges) {
      const end = clock + len;
      if (end > (known.get(client) ?? 0) && !(client === clientId && end <= ownEnd)) throw outOfOrder(`delete of unknown ${client}:${clock}`);
      if (!newDeletes) newDeletes = !allDeleted(doc, client, clock, Math.min(end, known.get(client) ?? 0)) || end > (known.get(client) ?? 0);
    }
  }
  if (ownEnd === ownBefore && !newDeletes) return { duplicate: true, doc };

  Y.applyUpdate(doc, update, VALIDATED);
  if (doc.store.pendingStructs || doc.store.pendingDs) throw outOfOrder('pending after apply');
  if (kind === 'rich-native-v1') { validateNativeTree(doc); return { duplicate: false, doc }; }
  if (regionText(doc).length > REGION_TEXT_MAX_UNITS) throw new LiveRegionRefusal('too_large', [`${regionText(doc).length} units`]);
  for (const format of formats) checkBlockFormat(doc, format, clientId, ownBefore, decoded.ds);
  return { duplicate: false, doc };
}

/** Validate the resulting state after a trusted snapshot revision without assuming a Y.Text root. */
export function validateRegionState(kind:RegionKind,doc:Y.Doc):void {
 if(kind==='rich-native-v1')validateNativeTree(doc);
 else if(regionText(doc).length>REGION_TEXT_MAX_UNITS)throw new LiveRegionRefusal('too_large');
}

/** The origin an applied update carries, so observers can tell a validated update from their own writes. */
const VALIDATED = 'validated-region-update';

function allDeleted(doc: Y.Doc, client: number, clock: number, end: number): boolean {
  for (let at = clock; at < end;) {
    const struct = Y.getItem(doc.store, Y.createID(client, at)) as Y.Item | Y.GC;
    if (!struct.deleted) return false;
    at = struct.id.clock + struct.length;
  }
  return true;
}

const inDeleteSet = (ds: DeleteSet, item: Y.Item) => (ds.clients.get(item.id.client) ?? []).some(({ clock, len }) => item.id.clock < clock + len && clock < item.id.clock + item.length);

/** The value `key` had on `item` before the update: the nearest format of `key` to its left that already existed. */
function valueBefore(item: Y.Item, key: string, clientId: number, ownBefore: number, ds: DeleteSet): unknown {
  for (let left = item.left; left; left = left.left) {
    if (!(left.content instanceof Y.ContentFormat) || left.content.key !== key) continue;
    if (left.id.client === clientId && left.id.clock >= ownBefore) continue;
    if (left.deleted && !inDeleteSet(ds, left)) continue;
    return left.content.value;
  }
  return null;
}

/**
 * A block attribute set by this update must land on line ends only, among the characters the update itself shows:
 * its own (new or earlier) and the one it was formatted from. Walks the format's range in the merged text.
 */
function checkBlockFormat(doc: Y.Doc, format: Y.Item, clientId: number, ownBefore: number, ds: DeleteSet): void {
  const { key, value } = format.content as Y.ContentFormat;
  if (value === null || !BLOCK_KEYS.has(key)) return;
  const placed = Y.getItem(doc.store, format.id) as Y.Item;
  if (placed.deleted) return;
  const from = format.rightOrigin;
  for (let next = placed.right; next; next = next.right) {
    if (next.deleted) continue;
    if (next.content instanceof Y.ContentFormat) { if (next.content.key === key) return; continue; }
    if (!(next.content instanceof Y.ContentString)) continue;
    const text = next.content.str;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') continue;
      const clock = next.id.clock + i;
      const shown = next.id.client === clientId || (from !== null && from.client === next.id.client && from.clock === clock);
      if (!shown) continue;
      const fresh = next.id.client === clientId && clock >= ownBefore;
      if (fresh || valueBefore(next, key, clientId, ownBefore, ds) !== value) throw unsupported(`${key} on a character that is not a line end`);
    }
  }
}
