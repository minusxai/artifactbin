/**
 * `isUserEditing` — the flag that decides whether a REMOTE write may be adopted
 * while a human is mid-sentence.
 *
 * The engine commits text on BLUR, so during typing the only copy of the work
 * lives in the frame's DOM: adopt there and the canvas remounts and it is gone
 * (lib/story/use-live-edits.ts). The consumer side of that rule is covered by
 * use-live-edits.ui.test.tsx — but it STUBS `isUserEditing`, so the tracking
 * itself, which is the part that can actually be wrong, had no test at all.
 *
 * Two properties, and the second is the one a "track focus instead" refactor
 * breaks: typing raises the flag, and a parked cursor does NOT — a caret left
 * in a paragraph must never block a live update indefinitely.
 */
import React, { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';

import { useInPlaceEdit } from '@/lib/story/use-in-place-edit';
import { STORY_TYPING_MESSAGE } from '@/lib/story-runtime/contract';

const NONCE = 'n'.repeat(24);

/** Drives the hook against a real iframe, the way ArtifactSurface does. */
function Harness({ probe }: { probe: (isUserEditing: () => boolean) => void }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const sourceRef = useRef('<p>hello</p>');
  const controller = useInPlaceEdit({
    frameRef,
    editing: true,
    sessionNonce: NONCE,
    sourceRef,
    onSourceEdited: () => {},
  });
  probe(controller.isUserEditing);
  return <iframe title="artifact" ref={frameRef} />;
}

/** A message as the FRAME sends it — same window identity the hook checks. */
function fromFrame(frame: HTMLIFrameElement, data: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source: frame.contentWindow }));
  });
}

function setup() {
  let isUserEditing!: () => boolean;
  const { container, unmount } = render(<Harness probe={(fn) => { isUserEditing = fn; }} />);
  const frame = container.querySelector('iframe') as HTMLIFrameElement;
  return { frame, isUserEditing: () => isUserEditing(), unmount };
}

describe('useInPlaceEdit — uncommitted typing tracking', () => {
  it('starts false: nothing has been typed yet', () => {
    const { isUserEditing } = setup();
    expect(isUserEditing()).toBe(false);
  });

  it('goes true while the document reports typing, and false when it stops', () => {
    const { frame, isUserEditing } = setup();
    fromFrame(frame, { type: STORY_TYPING_MESSAGE, nonce: NONCE, active: true });
    expect(isUserEditing()).toBe(true);
    // The commit lands (blur) and the document says so: adoption is safe again.
    fromFrame(frame, { type: STORY_TYPING_MESSAGE, nonce: NONCE, active: false });
    expect(isUserEditing()).toBe(false);
  });

  it('ignores a typing claim carrying the wrong nonce', () => {
    // The author's script shares the frame and can post anything it likes;
    // a forged "I am typing" would freeze every live update the reader gets.
    const { frame, isUserEditing } = setup();
    fromFrame(frame, { type: STORY_TYPING_MESSAGE, nonce: 'x'.repeat(24), active: true });
    expect(isUserEditing()).toBe(false);
  });

  it('ignores a typing claim from a window that is not the frame', () => {
    const { frame, isUserEditing } = setup();
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: STORY_TYPING_MESSAGE, nonce: NONCE, active: true },
        source: window, // not the document's frame
      }));
    });
    expect(isUserEditing()).toBe(false);
    // …and the real frame still works, so the check above is not vacuous.
    fromFrame(frame, { type: STORY_TYPING_MESSAGE, nonce: NONCE, active: true });
    expect(isUserEditing()).toBe(true);
  });
});
