// @vitest-environment jsdom
/**
 * validateRegionUpdate: every update a client sends is checked against the region's state before it is stored or
 * relayed. Each refusal is pinned with a crafted update; the honest side is pinned by running every update real
 * editors produce under random concurrent interleavings (the property harness) through the validator in delivery
 * order: an honest client is never refused.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { REGION_TEXT_MAX_UNITS, REGION_UPDATE_MAX_BYTES } from '@artifactbin/contracts';
import { createRegionState, LiveRegionRefusal, regionHtml, regionText, validateRegionUpdate, type RegionKind } from '..';
import { Room } from './harness';
import { checkConvergence } from './property';

const CLIENT = 7;

/** A client of a region that started from the server's bytes, recording each update it makes. */
function client(state: Uint8Array, clientId = CLIENT) {
  const doc = new Y.Doc({ gc: false });
  doc.clientID = clientId;
  Y.applyUpdate(doc, state, 'server');
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array, origin: unknown) => { if (origin !== 'server') updates.push(update); });
  return { doc, text: regionText(doc), updates, last: () => updates.at(-1)! };
}

const region = (kind: RegionKind = 'rich', html = '<p>Hello world</p><h2>Title</h2>') => createRegionState(kind, html).state;

function refusal(run: () => unknown): LiveRegionRefusal {
  try { run(); } catch (error) { if (error instanceof LiveRegionRefusal) return error; throw error; }
  throw new Error('expected a refusal');
}

describe('validateRegionUpdate accepts', () => {
  it('typing, a new line, a heading change and a link, and answers the merged state', () => {
    const state = region();
    const c = client(state);
    c.text.insert(5, ',', {});
    c.text.insert(12, ' again', { bold: true });
    c.text.insert(c.text.toString().indexOf('\n') + 1, 'Second\n', {});
    const titleEnd = c.text.toString().lastIndexOf('\n');
    c.text.format(titleEnd, 1, { level: 3 });
    c.text.format(0, 5, { link: 'https://example.com/a?b=1' });
    let live: Uint8Array | Y.Doc = state;
    for (const update of c.updates) {
      const check = validateRegionUpdate('rich', live, update, CLIENT);
      expect(check.duplicate).toBe(false);
      live = check.doc;
    }
    expect(regionHtml('rich', Y.encodeStateAsUpdate(live as Y.Doc))).toBe(regionHtml('rich', Y.encodeStateAsUpdate(c.doc)));
  });

  it('a retry as a duplicate, without applying anything new (inserts and deletes alike)', () => {
    const state = region();
    const c = client(state);
    c.text.insert(0, 'A', {});
    c.text.delete(3, 2);
    const live = validateRegionUpdate('rich', state, c.updates[0]!, CLIENT).doc;
    validateRegionUpdate('rich', live, c.updates[1]!, CLIENT);
    expect(validateRegionUpdate('rich', live, c.updates[0]!, CLIENT).duplicate).toBe(true);
    expect(validateRegionUpdate('rich', live, c.updates[1]!, CLIENT).duplicate).toBe(true);
    expect(validateRegionUpdate('rich', live, Y.mergeUpdates(c.updates), CLIENT).duplicate).toBe(true);
  });

  it('another client\'s text deleted by this client (deletes may target anyone\'s items)', () => {
    const state = region();
    const c = client(state);
    c.text.delete(0, 5);
    expect(validateRegionUpdate('rich', state, c.last(), CLIENT).duplicate).toBe(false);
  });

  it('content a gc-on client collected before sending (deleted content of its own id)', () => {
    const state = region();
    const doc = new Y.Doc();
    doc.clientID = CLIENT;
    Y.applyUpdate(doc, state);
    const before = Y.encodeStateVector(doc);
    regionText(doc).insert(0, 'gone', {});
    regionText(doc).delete(0, 4);
    const update = Y.encodeStateAsUpdate(doc, before);
    expect(Y.decodeUpdate(update).structs.some((struct) => struct instanceof Y.Item && struct.content instanceof Y.ContentDeleted)).toBe(true);
    expect(validateRegionUpdate('rich', state, update, CLIENT).duplicate).toBe(false);
  });
});

describe('validateRegionUpdate refuses', () => {
  it('foreign_client: a struct written under any other client id than the session\'s', () => {
    const state = region();
    const c = client(state, 8);
    c.text.insert(0, 'x', {});
    expect(refusal(() => validateRegionUpdate('rich', state, c.last(), CLIENT)).code).toBe('foreign_client');
  });

  it('outside_region: an item under another root, or a map key', () => {
    const state = region();
    const other = client(state);
    other.doc.getText('other').insert(0, 'x');
    expect(refusal(() => validateRegionUpdate('rich', state, other.last(), CLIENT)).code).toBe('outside_region');
    const map = new Y.Doc();
    map.clientID = CLIENT;
    let update: Uint8Array | undefined;
    map.on('update', (u: Uint8Array) => { update = u; });
    map.getMap('region').set('key', 'value');
    expect(refusal(() => validateRegionUpdate('rich', state, update!, CLIENT)).code).toBe('outside_region');
  });

  it('unsupported_content: an embed, a nested type, undecodable bytes', () => {
    const state = region();
    const embed = client(state);
    embed.text.insertEmbed(0, { image: 'x' });
    expect(refusal(() => validateRegionUpdate('rich', state, embed.last(), CLIENT)).code).toBe('unsupported_content');
    const nested = client(state);
    nested.text.insertEmbed(0, new Y.Text('inner'));
    expect(refusal(() => validateRegionUpdate('rich', state, nested.last(), CLIENT)).code).toBe('unsupported_content');
    expect(refusal(() => validateRegionUpdate('rich', state, new Uint8Array([9, 9, 9, 9]), CLIENT)).code).toBe('unsupported_content');
  });

  it.each([
    ['an unknown key', { color: 'red' }],
    ['a mark that is not true', { bold: 'yes' }],
    ['a heading level past 6', { level: 9 }],
    ['an unknown list type', { list: 'checklist' }],
    ['a list depth past the maximum', { depth: 40 }],
    ['an id outside the id grammar', { afId: '1 bad id' }],
  ])('unsupported_content: a format with %s', (_name, attrs) => {
    const state = region();
    const c = client(state);
    const at = c.text.toString().indexOf('\n');
    c.text.format(Object.keys(attrs)[0] === 'bold' ? 0 : at, 1, attrs);
    expect(refusal(() => validateRegionUpdate('rich', state, c.last(), CLIENT)).code).toBe('unsupported_content');
  });

  it.each(['javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x', ' vbscript:x'])('unsupported_content: an unsafe link %j', (href) => {
    const state = region();
    const c = client(state);
    c.text.format(0, 5, { link: href });
    expect(refusal(() => validateRegionUpdate('rich', state, c.last(), CLIENT)).code).toBe('unsupported_content');
  });

  it('unsupported_content: a block attribute on characters that are not a line end (formatted or inserted)', () => {
    const state = region();
    const formatted = client(state);
    formatted.text.format(0, 3, { level: 2 });
    expect(refusal(() => validateRegionUpdate('rich', state, formatted.last(), CLIENT)).code).toBe('unsupported_content');
    const inserted = client(state);
    inserted.text.insert(2, 'xy', { quote: true });
    expect(refusal(() => validateRegionUpdate('rich', state, inserted.last(), CLIENT)).code).toBe('unsupported_content');
  });

  it('unsupported_content: any format at all in a plain-text region', () => {
    const state = region('text', 'Plain title');
    const c = client(state);
    c.text.format(0, 3, { bold: true });
    expect(refusal(() => validateRegionUpdate('text', state, c.last(), CLIENT)).code).toBe('unsupported_content');
  });

  it('out_of_order: an update past a gap, with the state vector to resend from; the resend recovers', () => {
    const state = region();
    const c = client(state);
    c.text.insert(0, 'A', {});
    c.text.insert(1, 'B', {});
    const error = refusal(() => validateRegionUpdate('rich', state, c.updates[1]!, CLIENT));
    expect(error.code).toBe('out_of_order');
    const resend = Y.encodeStateAsUpdate(c.doc, error.stateVector!);
    const recovered = validateRegionUpdate('rich', state, resend, CLIENT);
    expect(recovered.duplicate).toBe(false);
    expect(regionText(recovered.doc).toString()).toBe(c.text.toString());
  });

  it('out_of_order: a delete of an item the state does not hold, and a merged update with a hole (Skip)', () => {
    const state = region();
    const peer = client(state, 8);
    peer.text.insert(0, 'peer', {});
    const c = client(state);
    Y.applyUpdate(c.doc, peer.last(), 'server');
    c.text.delete(0, 2);
    expect(refusal(() => validateRegionUpdate('rich', state, c.last(), CLIENT)).code).toBe('out_of_order');
    const holes = client(state);
    holes.text.insert(0, 'a', {});
    holes.text.insert(0, 'b', {});
    holes.text.insert(0, 'c', {});
    const merged = Y.mergeUpdates([holes.updates[0]!, holes.updates[2]!]);
    expect(refusal(() => validateRegionUpdate('rich', state, merged, CLIENT)).code).toBe('out_of_order');
  });

  it('too_large: an update past the byte limit, or a merged text past the unit limit', () => {
    const state = region();
    const big = client(state);
    big.text.insert(0, 'x'.repeat(REGION_UPDATE_MAX_BYTES + 10), {});
    expect(refusal(() => validateRegionUpdate('rich', state, big.last(), CLIENT)).code).toBe('too_large');
    const full = new Y.Doc({ gc: false });
    regionText(full).insert(0, `${'y'.repeat(REGION_TEXT_MAX_UNITS - 5)}\n`, {});
    const fullState = Y.encodeStateAsUpdate(full);
    const more = client(fullState);
    more.text.insert(0, 'z'.repeat(10), {});
    expect(refusal(() => validateRegionUpdate('rich', fullState, more.last(), CLIENT)).code).toBe('too_large');
  });
});

describe('validateRegionUpdate never refuses an honest editor', () => {
  afterEach(() => vi.restoreAllMocks());

  it('every update of real editors under random concurrent interleavings passes, in delivery order', () => {
    const send = Room.prototype.send;
    let checked = 0;
    vi.spyOn(Room.prototype, 'send').mockImplementation(function (this: Room, from, count = from.outbox.length) {
      for (let i = 0; i < count && from.outbox.length; i++) {
        const update = from.outbox[0]!;
        const check = validateRegionUpdate(this.kind, Y.encodeStateAsUpdate(this.server), update, from.doc.clientID);
        expect(regionText(check.doc).toString()).toBe((() => { const copy = new Y.Doc({ gc: false }); Y.applyUpdate(copy, Y.encodeStateAsUpdate(this.server)); Y.applyUpdate(copy, update); return regionText(copy).toString(); })());
        checked++;
        send.call(this, from, 1);
      }
    });
    checkConvergence(15, 30);
    expect(checked).toBeGreaterThan(50);
  });
});
