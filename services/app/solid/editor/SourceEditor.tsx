/* @jsxImportSource solid-js */
/**
 * components/SourceEditor in SOLID: the same CodeMirror engine (lib/source-editor/codemirror, whose
 * `createSourceView` imports no framework) mounted once per (readOnly, ariaLabel), with the same
 * contract: THE EDITOR OWNS THE BUFFER; A REPLACEMENT IS ANNOUNCED, NEVER INFERRED. Local typing
 * never writes back into the buffer; only a `revision` bump moves it, and it reads `value` at that
 * moment.
 *
 * The Solid hazard is the inverse of React's: React needed `latest` refs so a stale render could not
 * supply the text; Solid effects track whatever they read, so the replacement effect must read
 * `props.value` UNTRACKED — tracked, every keystroke echo would re-run it (harmless only while the
 * echo is exact, and a lagging echo is precisely the bug the React comment describes).
 */
import { createEffect, on, onCleanup, untrack } from 'solid-js';
import { createSourceView, type SourceView } from '@/lib/source-editor/codemirror';

export interface SourceEditorProps {
  value: string;
  /** Bumped whenever `value` was replaced from OUTSIDE this editor; the only thing that moves the buffer. */
  revision: number;
  /** Every keystroke; the caller owns debouncing it into a save. */
  onChange: (next: string) => void;
  /** Preserve focus/caret when upgrading from the plain editor. */
  initialSelection?: () => { start: number; end: number } | null;
  readOnly?: boolean;
  ariaLabel?: string;
}

export default function SourceEditor(props: SourceEditorProps) {
  let host!: HTMLDivElement;
  let view: SourceView | null = null;
  // Mounted once per editor (and again only when readOnly/ariaLabel change, as the React deps did):
  // its buffer, caret and undo history live as long as the pane does.
  createEffect(on([() => props.readOnly ?? false, () => props.ariaLabel ?? 'Markup source'], ([readOnly, ariaLabel]) => {
    const created = createSourceView({
      parent: host,
      doc: untrack(() => props.value),
      readOnly,
      ariaLabel,
      selection: untrack(() => props.initialSelection?.() ?? null),
      onChange: (next) => props.onChange(next),
    });
    view = created;
    onCleanup(() => { created.destroy(); if (view === created) view = null; });
  }));
  // Someone else moved the document.
  createEffect(on(() => props.revision, () => view?.replace(untrack(() => props.value)), { defer: true }));
  return <div ref={host} class="h-full" />;
}
