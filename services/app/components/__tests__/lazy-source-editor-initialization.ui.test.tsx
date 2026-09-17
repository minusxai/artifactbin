import { act, render, screen } from '@testing-library/react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { expect, it, vi } from 'vitest';

const stages = vi.hoisted(() => {
  let download!: () => void, initialize!: () => void;
  return {
    downloaded: new Promise<void>(resolve => { download = resolve; }),
    initialized: new Promise<void>(resolve => { initialize = resolve; }),
    download: () => download(), initialize: () => initialize(),
  };
});
vi.mock('@/components/SourceEditor', async () => {
  await stages.downloaded;
  function Mounted({ initialSelection }: { initialSelection: () => { start: number; end: number } | null }) {
    const ref = useRef<HTMLTextAreaElement>(null);
    useLayoutEffect(() => {
      const range = initialSelection();
      if (range) { ref.current!.focus(); ref.current!.setSelectionRange(range.start, range.end); }
    }, []);
    return <textarea ref={ref} aria-label="Initialized editor" defaultValue="<p>Draft</p>" />;
  }
  return { default: function Editor({ loading, initialSelection }: {
    loading: ReactNode; initialSelection: () => { start: number; end: number } | null;
  }) {
    const [ready, setReady] = useState(false);
    useLayoutEffect(() => { void stages.initialized.then(() => setReady(true)); }, []);
    return ready ? <Mounted initialSelection={initialSelection} /> : loading;
  } };
});
import LazySourceEditor from '../LazySourceEditor';

it('carries focus and selection through both download and initialization fallbacks', async () => {
  render(<LazySourceEditor value="<p>Draft</p>" revision={0} onChange={() => {}} />);
  const downloadInput = screen.getByLabelText('Markup source') as HTMLTextAreaElement;
  downloadInput.focus();
  downloadInput.setSelectionRange(3, 8);
  await act(async () => stages.download());
  const initializingInput = screen.getByLabelText('Markup source') as HTMLTextAreaElement;
  expect(document.activeElement).toBe(initializingInput);
  expect([initializingInput.selectionStart, initializingInput.selectionEnd]).toEqual([3, 8]);
  await act(async () => stages.initialize());
  const editor = await screen.findByLabelText('Initialized editor') as HTMLTextAreaElement;
  expect(document.activeElement).toBe(editor);
  expect([editor.selectionStart, editor.selectionEnd]).toEqual([3, 8]);
});
