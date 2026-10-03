/* @jsxImportSource solid-js */
/**
 * The same CodeMirror engine (lib/source-editor/codemirror, whose
 * `createSourceView` imports no framework) mounted once per (readOnly, ariaLabel), with the same
 * contract: THE EDITOR OWNS THE BUFFER; A REPLACEMENT IS ANNOUNCED, NEVER INFERRED. Local typing
 * never writes back into the buffer; only a `revision` bump moves it, and it reads `value` at that
 * moment.
 *
 * Solid effects track whatever they read, so the replacement effect must read
 * `props.value` UNTRACKED — tracked, every keystroke echo would re-run it (harmless only while the
 * echo is exact, and a lagging echo would overwrite what the user just typed).
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
  /**
   * A place to show while the editor is already open (a mount badge's "Edit script"): each new object moves the
   * caret there and scrolls to it. `initialSelection` is read once, on mount; this is read on every change.
   */
  reveal?: () => { start: number; end: number } | null;
  readOnly?: boolean;
  ariaLabel?: string;
}

export default function SourceEditor(props: SourceEditorProps) {
  let host!: HTMLDivElement;
  let view: SourceView | null = null;
  // Mounted once per editor (and again only when readOnly/ariaLabel change):
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
  // A place asked for after mount.
  createEffect(on(() => props.reveal?.() ?? null, (at) => { if (at) view?.reveal(at); }, { defer: true }));
  return <div ref={host} class="h-full" />;
}
