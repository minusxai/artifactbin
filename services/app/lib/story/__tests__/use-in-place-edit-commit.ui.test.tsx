import { useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useInPlaceEdit, type InPlaceEditController } from '../use-in-place-edit';
const nonce = 'n'.repeat(24);
function setup() {
  let edit!: InPlaceEditController;
  function Harness() {
    const frameRef = useRef<HTMLIFrameElement | null>(null);
    const sourceRef = useRef('<p>draft</p>');
    edit = useInPlaceEdit({ frameRef, sourceRef, editing: true, sessionNonce: nonce, onSourceEdited: () => {} });
    return <iframe ref={frameRef} title="document" />;
  }
  const result = render(<Harness />);
  return { edit, frame: result.container.querySelector('iframe')! };
}
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('strict navigation commit rejects timeout instead of permitting draft loss', async () => {
  vi.useFakeTimers();
  const { edit } = setup();
  const result = edit.commitPending(true).then(() => 'allowed', () => 'blocked');
  await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
  expect(await result).toBe('blocked');
});
it('simultaneous callers share the acknowledged commit, including a strict navigation caller', async () => {
  vi.useFakeTimers();
  const { edit, frame } = setup();
  let ordinary = false;
  let strict = false;
  const first = edit.commitPending().then(() => { ordinary = true; });
  const second = edit.commitPending(true).then(() => { strict = true; });
  await act(async () => {
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { type: 'mx:committed', nonce } }));
    await Promise.resolve();
  });
  expect(ordinary).toBe(true);
  expect(strict).toBe(true);
  await Promise.all([first, second]);
});
