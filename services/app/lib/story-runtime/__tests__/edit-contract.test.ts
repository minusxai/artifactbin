/**
 * The in-place editing protocol's two doors.
 *
 * `isEditFrameMessage` is the security boundary: the author's script shares the
 * frame's realm, so "it came from the frame" proves nothing — only the session
 * nonce does, and it is minted before author code exists (lib/story-runtime/pristine).
 */
import { describe, it, expect } from 'vitest';
import {
  isEditFrameMessage, isEditParentMessage, isSessionMessage,
  STORY_TEXT_EDIT_MESSAGE, STORY_TYPING_MESSAGE, STORY_SELECTION_MESSAGE, STORY_SELECTION_ACTION_MESSAGE, STORY_SELECTION_ACTIONS_MESSAGE,
  STORY_EDIT_KEY_MESSAGE, STORY_EDIT_READY_MESSAGE,
  STORY_EDIT_MODE_MESSAGE, STORY_APPLY_FORMAT_MESSAGE, STORY_APPLY_LINK_MESSAGE, STORY_SELECT_MESSAGE,
  STORY_SESSION_MESSAGE, STORY_DOCUMENT_MESSAGE,
  STORY_ANNOTATIONS_MESSAGE, STORY_ANNOTATION_HOVER_MESSAGE, STORY_ANNOTATION_LAYOUT_MESSAGE, STORY_ANNOTATION_PIN_MESSAGE,
} from '../contract';

const NONCE = 'a'.repeat(32);
const edit = (over: Record<string, unknown> = {}) => ({ type: STORY_TEXT_EDIT_MESSAGE, nonce: NONCE, path: '0.1', innerHtml: 'hi', ...over });

describe('isEditFrameMessage', () => {
  it('accepts every frame → parent edit message carrying this session\'s nonce', () => {
    for (const type of [STORY_EDIT_READY_MESSAGE, STORY_TEXT_EDIT_MESSAGE, STORY_TYPING_MESSAGE, STORY_SELECTION_MESSAGE, STORY_SELECTION_ACTION_MESSAGE, STORY_EDIT_KEY_MESSAGE]) {
      expect(isEditFrameMessage({ type, nonce: NONCE }, NONCE)).toBe(true);
    }
  });

  it('REJECTS a forgery with no nonce — the cheap attack', () => {
    expect(isEditFrameMessage({ type: STORY_TEXT_EDIT_MESSAGE, path: '0.1', innerHtml: 'FORGED' }, NONCE)).toBe(false);
  });

  it('rejects a guessed or stale nonce', () => {
    expect(isEditFrameMessage(edit({ nonce: 'b'.repeat(32) }), NONCE)).toBe(false);
    expect(isEditFrameMessage(edit({ nonce: '' }), NONCE)).toBe(false);
    expect(isEditFrameMessage(edit({ nonce: null }), NONCE)).toBe(false);
    expect(isEditFrameMessage(edit(), 'c'.repeat(32))).toBe(false);
  });

  it('rejects a PARENT-direction message replayed at the frame door, even with the nonce', () => {
    expect(isEditFrameMessage({ type: STORY_APPLY_FORMAT_MESSAGE, nonce: NONCE, path: '0.1' }, NONCE)).toBe(false);
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
    for (const type of [STORY_EDIT_MODE_MESSAGE, STORY_APPLY_FORMAT_MESSAGE, STORY_APPLY_LINK_MESSAGE, STORY_SELECT_MESSAGE, STORY_SELECTION_ACTIONS_MESSAGE]) {
      expect(isEditParentMessage({ type })).toBe(true);
    }
    expect(isEditParentMessage({ type: STORY_TEXT_EDIT_MESSAGE, nonce: NONCE })).toBe(false);
    expect(isEditParentMessage(null)).toBe(false);
  });
});

describe('annotation messages route like every other edit message', () => {
  it('mx:annotations is parent → frame; pin clicks and layout are frame → parent with the nonce', () => {
    expect(isEditParentMessage({ type: STORY_ANNOTATIONS_MESSAGE, mode: 'on', pins: [], openId: null, hoverId: null })).toBe(true);
    expect(isEditFrameMessage({ type: STORY_ANNOTATION_PIN_MESSAGE, nonce: NONCE, id: 'ann_x', rect: { x: 0, y: 0, width: 1, height: 1 } }, NONCE)).toBe(true);
    expect(isEditFrameMessage({ type: STORY_ANNOTATION_HOVER_MESSAGE, nonce: NONCE, id: 'ann_x' }, NONCE)).toBe(true);
    expect(isEditFrameMessage({ type: STORY_ANNOTATION_LAYOUT_MESSAGE, nonce: NONCE, positions: [{ id: 'ann_x', rect: { x: 0, y: 20, width: 1, height: 1 } }] }, NONCE)).toBe(true);
  });

  it('each is rejected at the other door — and the pin without its nonce', () => {
    expect(isEditFrameMessage({ type: STORY_ANNOTATIONS_MESSAGE, nonce: NONCE, mode: 'on', pins: [], openId: null, hoverId: null }, NONCE)).toBe(false);
    expect(isEditParentMessage({ type: STORY_ANNOTATION_PIN_MESSAGE, id: 'ann_x' })).toBe(false);
    expect(isEditParentMessage({ type: STORY_ANNOTATION_HOVER_MESSAGE, id: 'ann_x' })).toBe(false);
    expect(isEditFrameMessage({ type: STORY_ANNOTATION_PIN_MESSAGE, id: 'ann_x', rect: { x: 0, y: 0, width: 1, height: 1 } }, NONCE)).toBe(false);
    expect(isEditParentMessage({ type: STORY_ANNOTATION_LAYOUT_MESSAGE, positions: [] })).toBe(false);
    expect(isEditFrameMessage({ type: STORY_ANNOTATION_LAYOUT_MESSAGE, positions: [] }, NONCE)).toBe(false);
  });
});

describe('isSessionMessage', () => {
  it('accepts a session announcement with a long enough nonce', () => {
    expect(isSessionMessage({ type: STORY_SESSION_MESSAGE, nonce: NONCE })).toBe(true);
  });
  it('rejects a short, missing or non-string nonce — and anything else', () => {
    expect(isSessionMessage({ type: STORY_SESSION_MESSAGE, nonce: 'short' })).toBe(false);
    expect(isSessionMessage({ type: STORY_SESSION_MESSAGE })).toBe(false);
    expect(isSessionMessage({ type: STORY_SESSION_MESSAGE, nonce: 123 })).toBe(false);
    expect(isSessionMessage({ type: 'mx:hello', nonce: NONCE })).toBe(false);
  });
});
