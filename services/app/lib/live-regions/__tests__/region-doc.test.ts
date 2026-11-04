/**
 * The one way a region or cell document is opened (region-doc.ts): its root text first, then its state. A document
 * opened from formatted bytes, a fork of a formatted snapshot, and a revision written into one all delete a line end
 * exactly: the attributes of the line before never spread onto the text after it.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyRegionRevision, createRegionState, regionText } from '..';
import { forkRegionDoc, openRegionDoc } from '../region-doc';

/** Four blocks with ids; the middle two are empty, so deleting the third's line end follows the second's directly. */
const REGION = '<p data-af-id="af-1">abc</p><p data-af-id="af-2"></p><p data-af-id="af-3"></p><p data-af-id="af-4">z</p>';
const WITHOUT_AF_3 = [
  { insert: 'abc' }, { insert: '\n', attributes: { afId: 'af-1' } }, { insert: '\n', attributes: { afId: 'af-2' } },
  { insert: 'z' }, { insert: '\n', attributes: { afId: 'af-4' } },
];

describe('openRegionDoc', () => {
  it('a document opened from formatted bytes deletes a line end without spreading the attributes before it', () => {
    const { state } = createRegionState('rich', REGION);
    const text = regionText(openRegionDoc(state));
    text.delete(5, 1);
    expect(text.toDelta()).toEqual(WITHOUT_AF_3);
  });

  it('a fork of a formatted snapshot deletes a line end without spreading the attributes before it', () => {
    const { state, snapshot } = createRegionState('rich', REGION);
    const fork = forkRegionDoc(openRegionDoc(state), Y.decodeSnapshot(snapshot));
    regionText(fork).delete(5, 1);
    expect(regionText(fork).toDelta()).toEqual(WITHOUT_AF_3);
  });

  it('a revision removing an empty block between formatted ones (written into a fork) removes only its line end', () => {
    const { state, snapshot } = createRegionState('rich', REGION);
    const { update } = applyRegionRevision({ kind: 'rich', live: state, savedSnapshot: snapshot, html: REGION.replace('<p data-af-id="af-3"></p>', '') });
    const live = openRegionDoc(state);
    Y.applyUpdate(live, update);
    expect(regionText(live).toDelta()).toEqual(WITHOUT_AF_3);
  });

  it('writes with the given client id and keeps history unless asked not to', () => {
    const { state } = createRegionState('rich', REGION);
    const doc = openRegionDoc(state, { clientId: 9 });
    expect([doc.clientID, doc.gc, regionText(doc).toString()]).toEqual([9, false, 'abc\n\n\nz\n']);
    expect(openRegionDoc(undefined, { gc: true }).gc).toBe(true);
    expect(regionText(openRegionDoc()).toString()).toBe('');
  });
});
