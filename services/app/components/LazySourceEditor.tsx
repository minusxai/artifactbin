import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SourceEditorProps } from './SourceEditor';

/** Keep a failed/slow optional rich-editor download local to the source pane. */
class EditorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export default function LazySourceEditor(props: SourceEditorProps) {
  const [mounted, setMounted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const plainEditor = useRef<HTMLTextAreaElement>(null);
  const handoff = useRef<{ start: number; end: number } | null>(null);
  const attachPlainEditor = useCallback((input: HTMLTextAreaElement | null) => {
    // Capture at the DOM handoff, not when the download finishes: React may
    // commit later, while the person is still typing or moving the caret.
    if (!input) {
      const previous = plainEditor.current;
      const scope = previous?.getRootNode() as Document | ShadowRoot | undefined;
      handoff.current = previous && scope?.activeElement === previous
        ? { start: previous.selectionStart, end: previous.selectionEnd } : null;
    }
    plainEditor.current = input;
  }, []);
  const RichEditor = useMemo(() => lazy(() => import('@/components/SourceEditor')), [attempt]);
  useEffect(() => { setMounted(true); }, []);
  const fallback = (failed: boolean) => <div className="h-full flex flex-col bg-bg text-text">
    <div className="flex items-center gap-3 px-3 py-2 text-xs text-muted" role="status">
      {failed ? 'Rich editor unavailable. You can keep editing below.' : 'Loading rich editor… You can edit below.'}
      {failed && <button type="button" aria-label="Retry loading rich editor" className="underline cursor-pointer" onClick={() => setAttempt(n => n + 1)}>Retry</button>}
    </div>
    <textarea ref={attachPlainEditor} aria-label="Markup source" className="flex-1 min-h-0 w-full resize-none p-3 font-mono text-xs bg-bg text-text"
      spellCheck={false} value={props.value} onChange={event => props.onChange(event.target.value)} />
  </div>;
  return <EditorBoundary key={attempt} fallback={fallback(true)}>
    {mounted ? <Suspense fallback={fallback(false)}><RichEditor {...props} initialSelection={() => handoff.current} /></Suspense> : fallback(false)}
  </EditorBoundary>;
}
