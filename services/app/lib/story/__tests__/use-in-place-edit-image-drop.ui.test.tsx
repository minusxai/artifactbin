/**
 * Routing a pasted/dropped image from the frame to the page.
 *
 * The document is its own window, so the file can only arrive as a message;
 * the page's job is to hand it to the SAME insert the file picker calls, so
 * the three doors share one ingest. What is asserted here is the routing and
 * its guards — a forged nonce or a message from another window must not be
 * able to make the page upload something.
 */
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

import { useInPlaceEdit } from '@/lib/story/use-in-place-edit';
import { STORY_IMAGE_DROP_MESSAGE, STORY_IMAGE_REPLACE_MESSAGE } from '@/lib/story-runtime/contract';

const NONCE = 'n'.repeat(24);
const png = () => new File(['x'], 'clip.png', { type: 'image/png' });

function Harness({ onImageDrop, onImageReplaceRequest }: {
  onImageDrop: (file: File, where?: { replace?: string; at?: unknown }) => void;
  onImageReplaceRequest?: (path: string) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const sourceRef = useRef('<p>hello</p>');
  useInPlaceEdit({
    frameRef, editing: true, sessionNonce: NONCE, sourceRef,
    onSourceEdited: () => {}, onImageDrop, onImageReplaceRequest,
  });
  return <iframe title="artifact" ref={frameRef} />;
}

const mount = () => {
  const onImageDrop = vi.fn();
  const onImageReplaceRequest = vi.fn();
  const view = render(<Harness onImageDrop={onImageDrop} onImageReplaceRequest={onImageReplaceRequest} />);
  return { onImageDrop, onImageReplaceRequest, frame: view.container.querySelector('iframe')! };
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

/**
 * REPLACING rather than inserting: a drop onto an image, or a paste while one
 * is selected, names that image's body path. The page hands it on so the
 * replace path runs instead of the insert; no target is still an insert.
 */
describe('useInPlaceEdit — an image dropped ONTO an image', () => {
  it('hands the file on WITH the image it targets', async () => {
    const { onImageDrop, frame } = mount();
    const file = png();
    await dispatchMessage(frame.contentWindow, { type: STORY_IMAGE_DROP_MESSAGE, nonce: NONCE, file, target: '0.2' });
    await dispatchMessage(frame.contentWindow, { type: 'mx:committed', nonce: NONCE });
    expect(onImageDrop).toHaveBeenCalledWith(file, { replace: '0.2' });
  });

  it('ignores a target that is not a path', async () => {
    const { onImageDrop, frame } = mount();
    const file = png();
    await dispatchMessage(frame.contentWindow, { type: STORY_IMAGE_DROP_MESSAGE, nonce: NONCE, file, target: { evil: 1 } });
    await dispatchMessage(frame.contentWindow, { type: 'mx:committed', nonce: NONCE });
    expect(onImageDrop).toHaveBeenCalledWith(file);
  });
});

describe('useInPlaceEdit — a file dropped between blocks', () => {
  it('hands on the gap it landed in, or null for "outside every block"', async () => {
    const { onImageDrop, frame } = mount();
    const file = png();
    await dispatchMessage(frame.contentWindow, { type: STORY_IMAGE_DROP_MESSAGE, nonce: NONCE, file, at: { path: '0.1', side: 'before' } });
    await dispatchMessage(frame.contentWindow, { type: 'mx:committed', nonce: NONCE });
    expect(onImageDrop).toHaveBeenLastCalledWith(file, { at: { path: '0.1', side: 'before' } });
    await dispatchMessage(frame.contentWindow, { type: STORY_IMAGE_DROP_MESSAGE, nonce: NONCE, file, at: null });
    await dispatchMessage(frame.contentWindow, { type: 'mx:committed', nonce: NONCE });
    expect(onImageDrop).toHaveBeenLastCalledWith(file, { at: null });
  });

  it('drops a malformed gap rather than trusting it', async () => {
    const { onImageDrop, frame } = mount();
    const file = png();
    await dispatchMessage(frame.contentWindow, { type: STORY_IMAGE_DROP_MESSAGE, nonce: NONCE, file, at: { path: 7, side: 'sideways' } });
    await dispatchMessage(frame.contentWindow, { type: 'mx:committed', nonce: NONCE });
    expect(onImageDrop).toHaveBeenLastCalledWith(file, { at: null });
  });
});

describe('useInPlaceEdit — a double-clicked image asks to be replaced', () => {
  it('asks the page AT ONCE — the file picker needs the click\'s activation', async () => {
    const { onImageReplaceRequest, frame } = mount();
    await dispatchMessage(frame.contentWindow, { type: STORY_IMAGE_REPLACE_MESSAGE, nonce: NONCE, path: '0.2' });
    expect(onImageReplaceRequest).toHaveBeenCalledWith('0.2');
  });

  it('ignores a forged request', async () => {
    const { onImageReplaceRequest, frame } = mount();
    await dispatchMessage(frame.contentWindow, { type: STORY_IMAGE_REPLACE_MESSAGE, nonce: 'x'.repeat(24), path: '0.2' });
    await dispatchMessage(window, { type: STORY_IMAGE_REPLACE_MESSAGE, nonce: NONCE, path: '0.2' });
    expect(onImageReplaceRequest).not.toHaveBeenCalled();
  });
});
