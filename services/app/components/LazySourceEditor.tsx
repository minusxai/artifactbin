import { Component, Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  const RichEditor = useMemo(() => lazy(() => import('@/components/SourceEditor').then(module => {
    // Capture BEFORE Suspense removes the textarea (and dispatches blur).
    const input = plainEditor.current;
    const scope = input?.getRootNode() as Document | ShadowRoot | undefined;
    handoff.current = input && scope?.activeElement === input
      ? { start: input.selectionStart, end: input.selectionEnd } : null;
    return module;
  })), [attempt]);
  useEffect(() => { setMounted(true); }, []);
  const fallback = (failed: boolean) => <div className="h-full flex flex-col bg-bg text-text">
    <div className="flex items-center gap-3 px-3 py-2 text-xs text-muted" role="status">
      {failed ? 'Rich editor unavailable. You can keep editing below.' : 'Loading rich editor… You can edit below.'}
      {failed && <button type="button" aria-label="Retry loading rich editor" className="underline cursor-pointer" onClick={() => setAttempt(n => n + 1)}>Retry</button>}
    </div>
    <textarea ref={plainEditor} aria-label="Markup source" className="flex-1 min-h-0 w-full resize-none p-3 font-mono text-xs bg-bg text-text"
      spellCheck={false} value={props.value} onChange={event => props.onChange(event.target.value)} />
  </div>;
  return <EditorBoundary key={attempt} fallback={fallback(true)}>
    {mounted ? <Suspense fallback={fallback(false)}><RichEditor {...props} initialSelection={() => handoff.current} /></Suspense> : fallback(false)}
  </EditorBoundary>;
}
