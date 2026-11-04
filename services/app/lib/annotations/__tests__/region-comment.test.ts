/**
 * Save before commenting (lib/annotations/region-comment): a comment anchored inside an editable region first saves
 * the unsaved live text as a page version and anchors to that version, so the words it quotes are in saved source.
 */
import { describe, expect, it, vi } from 'vitest';
import type { HtmlNodeAnchor } from '@artifactbin/contracts';
import { anchorIds, commentAfterRegionSave, commentNeedsRegionSave } from '../region-comment';

const anchor = (nodeId: string, extra: Partial<HtmlNodeAnchor> = {}): HtmlNodeAnchor => ({ kind: 'html-node', v: 1, revision: '4', nodeId, quote: 'typed words', ...extra });
const membership = { inside: new Set(['region', 'p-in']), known: new Set(['region', 'p-in', 'p-out', 'body']) };

describe('commentNeedsRegionSave', () => {
  it('is true for a node inside a region, the region itself, or a node the saved page does not hold yet', () => {
    expect(commentNeedsRegionSave({ anchor: anchor('p-in') }, membership)).toBe(true);
    expect(commentNeedsRegionSave({ anchor: anchor('region') }, membership)).toBe(true);
    expect(commentNeedsRegionSave({ nodeId: 'p-in' }, membership)).toBe(true);
    expect(commentNeedsRegionSave({ anchor: anchor('fresh') }, membership)).toBe(true);
    expect(commentNeedsRegionSave({ anchor: anchor('p-out', { segments: [{ nodeId: 'p-out', quote: 'a', range: { start: 0, end: 1, length: 1, fingerprint: '12345678' } }, { nodeId: 'p-in', quote: 'b', range: { start: 0, end: 1, length: 1, fingerprint: '12345678' } }] }) }, membership)).toBe(true);
  });
  it('is false for a node outside every region', () => {
    expect(commentNeedsRegionSave({ anchor: anchor('p-out') }, membership)).toBe(false);
    expect(commentNeedsRegionSave({ nodeId: 'body' }, membership)).toBe(false);
    expect(anchorIds({ anchor: anchor('p-out', { ancestorId: 'body' }) })).toEqual(['p-out', 'body']);
  });
});

describe('commentAfterRegionSave', () => {
  it('saves first and anchors to the saved version, before the comment is sent', async () => {
    const order: string[] = [];
    const save = vi.fn(async () => { order.push('flush'); return 9; });
    const subject = { anchor: anchor('p-in'), quote: 'typed words' };
    const next = await commentAfterRegionSave(subject, { membership: () => membership, save });
    order.push('create');
    expect(order).toEqual(['flush', 'create']);
    expect(next).toEqual({ ...subject, anchor: { ...subject.anchor, revision: '9' } });
    expect(subject.anchor.revision).toBe('4');
  });
  it('leaves a comment outside regions alone and saves nothing', async () => {
    const save = vi.fn(async () => 9);
    const subject = { anchor: anchor('p-out') };
    expect(await commentAfterRegionSave(subject, { membership: () => membership, save })).toBe(subject);
    expect(save).not.toHaveBeenCalled();
  });
  it('a node-id comment inside a region saves first and keeps its node id', async () => {
    const save = vi.fn(async () => 3);
    const subject = { nodeId: 'p-in' };
    expect(await commentAfterRegionSave(subject, { membership: () => membership, save })).toBe(subject);
    expect(save).toHaveBeenCalledOnce();
  });
  it('a failed save fails the comment', async () => {
    await expect(commentAfterRegionSave({ anchor: anchor('p-in') }, { membership: () => membership, save: async () => { throw new Error('offline'); } })).rejects.toThrow('offline');
  });
});
