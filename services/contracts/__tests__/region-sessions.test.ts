/**
 * The live co-editing contract (src/region-sessions.ts): the channel name, the limits, and one value of every
 * wire shape, so a change to any of them is a deliberate edit here and in both ends (lib/region-sessions and the
 * @afbin/native-regions frame editor).
 */
import { describe, expect, it } from 'vitest';
import {
  REGION_IDLE_SAVE_MS, REGION_TEXT_MAX_UNITS, REGION_UPDATE_MAX_BYTES, regionsChannel,
  type RegionCaret, type RegionFlushReply, type RegionFrameMessage, type RegionKind, type RegionOpenReply,
  type RegionParentMessage, type RegionRefusalBody, type RegionRefusalCode, type RegionStreamFrame,
  type RegionUpdateReply, type RegionUpdateRequest, DOC_REGION, cellKey, isCellKey, parseCellKey, CELL_READONLY, type CollabStatus, type RegionContentReply, type RegionWriteRequest, type RegionWriteReply,
} from '../src/region-sessions';
import * as contract from '../src/region-sessions';

describe('region sessions contract', () => {
  it('keys a dataset text cell by link name, row _id and field, outside the region id grammar', () => {
    const key = cellKey({ dataset: 'tasks', rowId: 'r_Ab-9_x', column: 'description' });
    expect(key).toBe('cell:tasks:r_Ab-9_x:description');
    expect(isCellKey(key)).toBe(true);
    expect(parseCellKey(key)).toEqual({ dataset: 'tasks', rowId: 'r_Ab-9_x', column: 'description' });
    for (const bad of ['cell:tasks:x1:description', 'cell:9tasks:r_a:b', 'cell:tasks:r_a:', 'cell:tasks:r_a:b,c', 'tasks:r_a:b', 'af-6', 'cell:t:r_a:b:c'])
      expect(isCellKey(bad), bad).toBe(false);
    const statuses: CollabStatus[] = ['synced', 'pending', 'offline', 'readonly'];
    expect(statuses).toHaveLength(4);
    expect(CELL_READONLY).toBe('readonly');
  });

  it('wakes a page through one lower-case NOTIFY channel', () => {
    expect(regionsChannel('AbC123')).toBe('regions_abc123');
  });

  it('pins the limits both ends enforce', () => {
    expect(REGION_UPDATE_MAX_BYTES).toBe(256 * 1024);
    expect(REGION_TEXT_MAX_UNITS).toBe(1_000_000);
    // Versions are history: a pause becomes a checkpoint after two quiet minutes, and nothing cuts unbroken typing
    // (readers, the doc's title and agents follow the live text itself, not versions).
    expect(REGION_IDLE_SAVE_MS).toBe(120_000);
    expect(Object.keys(contract)).not.toContain('REGION_MAX_UNSAVED_MS');
  });

  it('carries every wire shape as JSON or structured-clone data', () => {
    const kind: RegionKind = 'rich';
    const open: RegionOpenReply = { regionId: 'af-6', kind, clientId: 7, seq: 3, state: 'AA==', savedVersion: 2 };
    const request: RegionUpdateRequest = { clientId: 7, update: 'AA==' };
    const replies: RegionUpdateReply[] = [{ seq: 4 }, { seq: 4, duplicate: true }];
    const flush: RegionFlushReply = { version: 3 };
    const content: RegionContentReply[] = [{ regionId: 'af-6', kind, version: 3, markdown: '# Plan' }, { regionId: 'af-6', kind, version: 3, html: '<h1>Plan</h1>' }];
    const write: RegionWriteRequest[] = [{ markdown: '# Plan', base_version: 3 }, { html: '<h1>Plan</h1>', base_version: 3 }];
    const written: RegionWriteReply = { regionId: 'af-6', kind, version: 4, html: '<h1>Plan</h1>', markdown: '# Plan' };
    const agentRefusals: RegionRefusalBody[] = [
      { error: 'unsupported_content', details: ['<img>'] },
      { error: 'region_snapshot_missing', version: 4 },
      { error: 'region_ambiguous', regions: [{ regionId: 'af-6', kind }, { regionId: 'af-7', kind: 'text' }] },
    ];
    // The doc alias is outside the region id grammar (a letter first), so no declared region can take it.
    expect(DOC_REGION).toBe('_doc');
    expect(/^[A-Za-z]/.test(DOC_REGION)).toBe(false);
    const codes: RegionRefusalCode[] = ['region_ambiguous', 'unsupported_content', 'foreign_client', 'outside_region', 'out_of_order', 'too_large', 'region_not_found', 'region_snapshot_missing'];
    const refusal: RegionRefusalBody = { error: 'out_of_order', stateVector: 'AA==' };
    const frames: RegionStreamFrame[] = [
      { type: 'updates', regionId: 'af-6', from: 4, to: 5, updates: ['AA=='] },
      { type: 'reset', regionId: 'af-6', seq: 5, state: 'AA==' },
      { type: 'saved', version: 3, regions: { 'af-6': 5 } },
      { type: 'closed', regionId: 'af-6', reason: 'access' },
    ];
    const caret: RegionCaret = { regionId: 'af-6', anchor: 'AA==', head: 'AA==' };
    const toFrame: RegionParentMessage[] = [
      { kind: 'regions-enabled', regionIds: ['af-6'] },
      { kind: 'region-session', regionId: 'af-6', regionKind: kind, clientId: 7, state: new Uint8Array([0]), seq: 3 },
      { kind: 'region-remote', regionId: 'af-6', updates: [new Uint8Array([0])], seq: 4 },
      { kind: 'region-ack', regionId: 'af-6', seq: 4 },
      { kind: 'region-closed', regionId: 'af-6', reason: 'access' },
      { kind: 'region-paint', carets: [{ ...caret, id: 'u1', label: 'Ada' }] },
      { kind: 'region-command', regionId: 'af-6', name: 'bold' },
    ];
    const fromFrame: RegionFrameMessage[] = [
      { kind: 'region-open', regionId: 'af-6' },
      { kind: 'region-update', regionId: 'af-6', update: new Uint8Array([0]) },
      { kind: 'region-caret', ...caret, marks: ['bold'], block: 'paragraph' },
      { kind: 'region-blur' },
      { kind: 'region-slash', regionId: 'af-6', x: 10, y: 20 },
      { kind: 'region-link', regionId: 'af-6', href: 'https://example.com' },
      { kind: 'region-link', regionId: 'af-6', href: null },
    ];
    for (const value of [open, request, ...replies, flush, refusal, ...frames, ...content, ...write, written, ...agentRefusals]) expect(JSON.parse(JSON.stringify(value))).toEqual(value);
    for (const message of [...toFrame, ...fromFrame]) expect(structuredClone(message)).toEqual(message);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
