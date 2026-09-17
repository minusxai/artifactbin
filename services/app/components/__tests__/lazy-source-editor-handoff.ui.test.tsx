import { act, render, screen, waitFor } from '@testing-library/react';
import { useLayoutEffect, useRef } from 'react';
import { expect, it, vi } from 'vitest';

const pending = vi.hoisted(() => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release, loaded: false, ready: false };
});
vi.mock('@/components/SourceEditor', () => {
  pending.loaded = true;
  return { default: function RichEditor({ value, initialSelection }: {
    value: string; initialSelection: () => { start: number; end: number } | null;
  }) {
    if (!pending.ready) throw pending.promise;
    const ref = useRef<HTMLTextAreaElement>(null);
    useLayoutEffect(() => {
      const selection = initialSelection();
      if (selection) {
        ref.current!.focus();
        ref.current!.setSelectionRange(selection.start, selection.end);
      }
    }, []);
    return <textarea ref={ref} aria-label="Rich source" defaultValue={value} />;
  } };
});
import LazySourceEditor from '../LazySourceEditor';

it('uses focus and selection at replacement, even when the module resolved earlier', async () => {
  render(<LazySourceEditor value="<p>Draft</p>" revision={0} onChange={() => {}} />);
  await waitFor(() => expect(pending.loaded).toBe(true));
  // Module resolution is not DOM replacement. Interaction can continue while
  // React is waiting to commit the rich editor.
  const plain = screen.getByLabelText('Markup source') as HTMLTextAreaElement;
  plain.focus();
  plain.setSelectionRange(3, 8);
  await act(async () => { pending.ready = true; pending.release(); });
  const rich = await screen.findByLabelText('Rich source') as HTMLTextAreaElement;
  expect(document.activeElement).toBe(rich);
  expect([rich.selectionStart, rich.selectionEnd]).toEqual([3, 8]);
});
