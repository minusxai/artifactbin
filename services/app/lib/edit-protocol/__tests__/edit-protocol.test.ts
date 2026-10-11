/**
 * The in-place editing protocol's two doors.
 *
 * `isEditFrameMessage` is the security boundary: the author's script shares the
 * frame's realm, so "it came from the frame" proves nothing — only the session
 * nonce does, and it is minted before author code exists (RuntimeChannel, lib/islands/island-controller).
 */
import { describe, it, expect } from 'vitest';
import { STORY_DOCUMENT_MESSAGE } from '@/lib/story-runtime/contract';
import { isEditFrameMessage, isEditParentMessage } from '..';

const NONCE = 'a'.repeat(32);
const edit = (over: Record<string, unknown> = {}) => ({ type: 'mx:text-edit', nonce: NONCE, path: '0.1', innerHtml: 'hi', ...over });

describe('isEditFrameMessage', () => {
  it('accepts every frame → parent edit message carrying this session\'s nonce', () => {
    for (const type of ['mx:edit-ready', 'mx:text-edit', 'mx:typing', 'mx:selection', 'mx:selection-action', 'mx:edit-key']) {
      expect(isEditFrameMessage({ type, nonce: NONCE }, NONCE)).toBe(true);
    }
  });

  it('REJECTS a forgery with no nonce — the cheap attack', () => {
    expect(isEditFrameMessage({ type: 'mx:text-edit', path: '0.1', innerHtml: 'FORGED' }, NONCE)).toBe(false);
  });

  it('rejects a guessed or stale nonce', () => {
    expect(isEditFrameMessage(edit({ nonce: 'b'.repeat(32) }), NONCE)).toBe(false);
    expect(isEditFrameMessage(edit({ nonce: '' }), NONCE)).toBe(false);
    expect(isEditFrameMessage(edit({ nonce: null }), NONCE)).toBe(false);
    expect(isEditFrameMessage(edit(), 'c'.repeat(32))).toBe(false);
  });

  it('rejects a PARENT-direction message replayed at the frame door, even with the nonce', () => {
    expect(isEditFrameMessage({ type: 'mx:apply-format', nonce: NONCE, path: '0.1' }, NONCE)).toBe(false);
    expect(isEditFrameMessage({ type: STORY_DOCUMENT_MESSAGE, nonce: NONCE, nodes: [] }, NONCE)).toBe(false);
  });

  it('rejects junk without throwing', () => {
    for (const junk of [null, undefined, 0, '', 'mx:text-edit', [], { nonce: NONCE }, { type: 42, nonce: NONCE }]) {
      expect(isEditFrameMessage(junk, NONCE)).toBe(false);
    }
  });
});

describe('isEditParentMessage', () => {
  it('accepts the parent → frame set and nothing else', () => {
    for (const type of ['mx:edit-mode', 'mx:apply-format', 'mx:apply-link', 'mx:select', 'mx:selection-actions']) {
      expect(isEditParentMessage({ type })).toBe(true);
    }
    expect(isEditParentMessage({ type: 'mx:text-edit', nonce: NONCE })).toBe(false);
    expect(isEditParentMessage(null)).toBe(false);
  });
});

describe('annotation messages route like every other edit message', () => {
  it('mx:annotations is parent → frame; pin clicks and layout are frame → parent with the nonce', () => {
    expect(isEditParentMessage({ type: 'mx:annotations', mode: 'on', pins: [], openId: null, hoverId: null })).toBe(true);
    expect(isEditFrameMessage({ type: 'mx:annotation-pin', nonce: NONCE, id: 'ann_x', rect: { x: 0, y: 0, width: 1, height: 1 } }, NONCE)).toBe(true);
    expect(isEditFrameMessage({ type: 'mx:annotation-hover', nonce: NONCE, id: 'ann_x' }, NONCE)).toBe(true);
    expect(isEditFrameMessage({ type: 'mx:annotation-layout', nonce: NONCE, positions: [{ id: 'ann_x', rect: { x: 0, y: 20, width: 1, height: 1 } }] }, NONCE)).toBe(true);
  });

  it('each is rejected at the other door — and the pin without its nonce', () => {
    expect(isEditFrameMessage({ type: 'mx:annotations', nonce: NONCE, mode: 'on', pins: [], openId: null, hoverId: null }, NONCE)).toBe(false);
    expect(isEditParentMessage({ type: 'mx:annotation-pin', id: 'ann_x' })).toBe(false);
    expect(isEditParentMessage({ type: 'mx:annotation-hover', id: 'ann_x' })).toBe(false);
    expect(isEditFrameMessage({ type: 'mx:annotation-pin', id: 'ann_x', rect: { x: 0, y: 0, width: 1, height: 1 } }, NONCE)).toBe(false);
    expect(isEditParentMessage({ type: 'mx:annotation-layout', positions: [] })).toBe(false);
    expect(isEditFrameMessage({ type: 'mx:annotation-layout', positions: [] }, NONCE)).toBe(false);
  });
});

describe('the keys a framed document forwards', () => {
  it('signs the forwarded keys like every other frame message', () => {
    for (const type of ['mx:edit-flush', 'mx:comment-key', 'mx:history']) {
      expect(isEditFrameMessage({ type, nonce: NONCE }, NONCE), type).toBe(true);
      expect(isEditFrameMessage({ type }, NONCE), `${type} unsigned`).toBe(false);
      expect(isEditParentMessage({ type }), `${type} is not a parent command`).toBe(false);
    }
  });
});

/**
 * THE WIRE IS FROZEN: island builds already published (data/objects/island-builds) keep talking to a newer app,
 * so every edit and annotation message id the guards know is pinned here, by direction.
 */
describe('the wire strings', () => {
  const FRAME = ['mx:annotation-hover', 'mx:annotation-layout', 'mx:annotation-pin', 'mx:block-edit', 'mx:comment-key', 'mx:committed',
    'mx:edit-error', 'mx:edit-flush', 'mx:edit-key', 'mx:edit-ready', 'mx:flow-edit', 'mx:history', 'mx:image-drop', 'mx:image-replace',
    'mx:layout-edit', 'mx:link-key', 'mx:open-script', 'mx:selection', 'mx:selection-action', 'mx:slide-title', 'mx:text-edit', 'mx:typing'];
  const PARENT = ['mx:annotations', 'mx:apply-format', 'mx:apply-link', 'mx:commit', 'mx:edit-mode', 'mx:focus-text', 'mx:inline',
    'mx:markdown-block', 'mx:markdown-table', 'mx:paste', 'mx:select', 'mx:selection-actions', 'mx:spotlight'];

  it('accepts every frame id signed and every parent id, each at its own door only', () => {
    for (const type of FRAME) {
      expect(isEditFrameMessage({ type, nonce: NONCE }, NONCE), type).toBe(true);
      expect(isEditParentMessage({ type }), type).toBe(false);
    }
    for (const type of PARENT) {
      expect(isEditParentMessage({ type }), type).toBe(true);
      expect(isEditFrameMessage({ type, nonce: NONCE }, NONCE), type).toBe(false);
    }
  });

  it('knows no other id: a near miss and the reader wire are refused at both doors', () => {
    for (const type of ['mx:edit', 'mx:selections', 'mx:annotation', STORY_DOCUMENT_MESSAGE, 'mx:reader-mode', 'mx:frame-bridge']) {
      expect(isEditFrameMessage({ type, nonce: NONCE }, NONCE), type).toBe(false);
      expect(isEditParentMessage({ type }), type).toBe(false);
    }
  });
});
