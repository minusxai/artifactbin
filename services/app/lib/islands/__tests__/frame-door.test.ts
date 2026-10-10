/**
 * The frame's door (lib/islands/frame-door) restates the bridge envelope's id so the reader chunk carries no
 * contract value: it must stay the contract's value exactly.
 */
import { describe, expect, it } from 'vitest';
import { isFrameBridgeEnvelope, STORY_FRAME_BRIDGE_MESSAGE } from '@/lib/story-runtime/contract';
import { FRAME_BRIDGE_MESSAGE } from '../frame-door';

describe('the frame door envelope', () => {
  it('names the envelope once: the door restates the contract value exactly', () => {
    expect(FRAME_BRIDGE_MESSAGE).toBe(STORY_FRAME_BRIDGE_MESSAGE);
    expect(isFrameBridgeEnvelope({ type: STORY_FRAME_BRIDGE_MESSAGE, key: 'k', payload: { kind: 'hello' } })).toBe(true);
    for (const junk of [null, 'mx:frame-bridge', { type: STORY_FRAME_BRIDGE_MESSAGE }, { type: STORY_FRAME_BRIDGE_MESSAGE, payload: { kind: 1 } }, { type: 'mx:other', payload: { kind: 'hello' } }]) {
      expect(isFrameBridgeEnvelope(junk)).toBe(false);
    }
  });
});
