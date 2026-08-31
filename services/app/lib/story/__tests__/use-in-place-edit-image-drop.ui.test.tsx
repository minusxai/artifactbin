/**
 * Routing a pasted/dropped image from the frame to the page.
 *
 * The document is its own window, so the file can only arrive as a message;
 * the page's job is to hand it to the SAME insert the file picker calls, so
 * the three doors share one ingest. What is asserted here is the routing and
 * its guards — a forged nonce or a message from another window must not be
 * able to make the page upload something.
 */
import React, { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

import { useInPlaceEdit } from '@/lib/story/use-in-place-edit';
import { STORY_IMAGE_DROP_MESSAGE } from '@/lib/story-runtime/contract';

const NONCE = 'n'.repeat(24);
const png = () => new File(['x'], 'clip.png', { type: 'image/png' });

function Harness({ onImageDrop }: { onImageDrop: (file: File) => void }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const sourceRef = useRef('<p>hello</p>');
  useInPlaceEdit({
    frameRef, editing: true, sessionNonce: NONCE, sourceRef,
    onSourceEdited: () => {}, onImageDrop,
  });
  return <iframe title="artifact" ref={frameRef} />;
}

const mount = () => {
  const onImageDrop = vi.fn();
  const view = render(<Harness onImageDrop={onImageDrop} />);
  return { onImageDrop, frame: view.container.querySelector('iframe')! };
};

/** The insert drains first, so delivery lands a microtask later than the post. */
const dispatchMessage = async (source: Window | null, data: Record<string, unknown>) => {
  await act(async () => {
    window.dispatchEvent(new MessageEvent('message', { data, source }));
    await Promise.resolve();
  });
};

describe('useInPlaceEdit — an image pasted or dropped in the document', () => {
  it('hands the file to the page, which inserts it', async () => {
    const { onImageDrop, frame } = mount();
    const file = png();
    await dispatchMessage(frame.contentWindow, { type: STORY_IMAGE_DROP_MESSAGE, nonce: NONCE, file });
    await dispatchMessage(frame.contentWindow, { type: 'mx:committed', nonce: NONCE });
    expect(onImageDrop).toHaveBeenCalledWith(file);
  });

  it('ignores a message carrying the wrong nonce — the author shares that realm', async () => {
    const { onImageDrop, frame } = mount();
    await dispatchMessage(frame.contentWindow, { type: STORY_IMAGE_DROP_MESSAGE, nonce: 'x'.repeat(24), file: png() });
    expect(onImageDrop).not.toHaveBeenCalled();
  });

  it('ignores a message from a window that is not this document', async () => {
    const { onImageDrop } = mount();
    await dispatchMessage(window, { type: STORY_IMAGE_DROP_MESSAGE, nonce: NONCE, file: png() });
    expect(onImageDrop).not.toHaveBeenCalled();
  });
});

/**
 * An image insert is a STRUCTURAL change: it rewrites the source from
 * `sourceRef.current` and re-renders. So it owes the same debt every exit from
 * edit mode owes — the document commits text on BLUR, and a paste never blurs
 * anything (the caret stays in the paragraph it was in), so text pasted a
 * moment earlier still lives only in the frame's DOM. Inserting without asking
 * for it first composes against a stale source and silently drops it.
 *
 * Found by a REAL ⌘V: paste text, then paste an image, and the text was gone
 * from the stored source. The file picker never showed it because clicking a
 * toolbar button blurs the host, which commits on the way.
 */
describe('useInPlaceEdit — an image insert drains uncommitted typing first', () => {
  it('asks the document to commit, and inserts only once it has', async () => {
    const { onImageDrop, frame } = mount();
    const posted: unknown[] = [];
    frame.contentWindow!.postMessage = ((m: unknown) => { posted.push(m); }) as typeof window.postMessage;

    const file = png();
    await dispatchMessage(frame.contentWindow, { type: STORY_IMAGE_DROP_MESSAGE, nonce: NONCE, file });

    expect(posted.some((m) => (m as { type?: string })?.type === 'mx:commit')).toBe(true);
    expect(onImageDrop).not.toHaveBeenCalled();   // still waiting on the document

    await dispatchMessage(frame.contentWindow, { type: 'mx:committed', nonce: NONCE });
    expect(onImageDrop).toHaveBeenCalledWith(file);
  });
});
