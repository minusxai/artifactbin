import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SourceEditorProps } from './SourceEditor';

const SOURCE_COLORS = { backgroundColor: '#1e1e1e', color: '#d4d4d4' };
const SOURCE_FONT = { fontFamily: 'Menlo, Monaco, Consolas, monospace', fontSize: 12, lineHeight: '18px' };

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
    // The module download and Monaco initialization can each render this
    // fallback. Carry focus through that intermediate textarea too.
    if (input && handoff.current) {
      input.focus();
      input.setSelectionRange(handoff.current.start, handoff.current.end);
    }
  }, []);
  const RichEditor = useMemo(() => lazy(() => import('@/components/SourceEditor')), [attempt]);
  useEffect(() => { setMounted(true); }, []);
  const fallback = (failed: boolean) => <div className="h-full w-full flex flex-col" style={SOURCE_COLORS}>
    <div className="relative flex min-h-0 flex-1 overflow-hidden" style={SOURCE_FONT}>
      <div aria-hidden="true" className="w-12 shrink-0 overflow-hidden text-right" style={{ color: '#858585' }}>
        <pre data-source-line-numbers className="m-0 py-2 pr-3" style={{ font: 'inherit' }}>
          {props.value.split('\n').map((_, index) => index + 1).join('\n')}
        </pre>
      </div>
      <textarea ref={attachPlainEditor} aria-label={props.ariaLabel ?? "Markup source"} readOnly={props.readOnly}
        className="min-h-0 min-w-0 flex-1 resize-none border-0 px-1 py-2 outline-none"
        style={{ ...SOURCE_COLORS, ...SOURCE_FONT, tabSize: 2 }} wrap="off"
        onScroll={event => {
          const numbers = event.currentTarget.parentElement?.querySelector<HTMLElement>('[data-source-line-numbers]');
          if (numbers) numbers.style.transform = `translateY(${-event.currentTarget.scrollTop}px)`;
        }}
        spellCheck={false} autoCapitalize="off" autoCorrect="off"
        value={props.value} onChange={event => props.onChange(event.target.value)} />
    </div>
    <div className="flex items-center gap-3 px-3 py-2 text-xs" style={{ color: '#a0a0a0', borderTop: '1px solid #333' }} role="status">
      {failed ? 'Rich editor unavailable.' : 'Loading rich editor…'} {!props.readOnly && 'You can keep editing.'}
      {failed && <button type="button" aria-label="Retry loading rich editor" className="underline cursor-pointer" onClick={() => setAttempt(n => n + 1)}>Retry</button>}
    </div>
  </div>;
  return <EditorBoundary key={attempt} fallback={fallback(true)}>
    {mounted ? <Suspense fallback={fallback(false)}><RichEditor {...props} loading={fallback(false)} initialSelection={() => handoff.current} /></Suspense> : fallback(false)}
  </EditorBoundary>;
}
