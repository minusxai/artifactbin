'use client';

/**
 * THE MARKUP SOURCE EDITOR — CodeMirror, mounted by lib/source-editor/codemirror.
 *
 * The whole module sits behind InPlaceEditor's dynamic import, so a reader —
 * and an owner who never opens `code` — pays nothing. That boundary is
 * enforced by lib/__tests__/reader-bundle-hygiene. It is served from this
 * origin and needs no worker, so the app CSP needs nothing for it.
 */
import { useEffect, useRef } from 'react';
import { createSourceView, type SourceView } from '@/lib/source-editor/codemirror';

/**
 * THE EDITOR OWNS THE BUFFER; A REPLACEMENT IS ANNOUNCED, NEVER INFERRED.
 *
 * Writing `value` back into the editor on every render is a race, and a nasty
 * one: each keystroke sets React state, and a render that lands one keystroke
 * behind hands the editor a STALE string — wiping whatever was typed in between
 * and taking the caret with it. Measured at full typing speed against the
 * previous editor: "typed in code mode" reached the SERVER as "typemode"; the
 * same words at 150ms a key arrived whole. No hand test finds that, and no
 * jsdom test can, so scripts/gate-editor-v2.mjs §4 types with no delay and
 * compares exactly.
 *
 * Guarding on "is `value` what I last emitted?" is the obvious fix and is the
 * SAME BUG one step along: two keystrokes before a render make the effect's
 * `value` stale against a buffer that has both, and it writes the older one
 * back. There is no way to tell a stale echo from a real replacement by looking
 * at the text, so the editor stops trying — `revision` is the parent saying
 * "this `value` came from somewhere else". Local typing therefore never writes
 * to the buffer at all, and a live edit or a 409 rebase still lands.
 */
export interface SourceEditorProps {
  value: string;
  /**
   * Bumped by the caller whenever `value` was replaced from OUTSIDE this editor
   * — a collaborator's live edit, a 409 rebase. It is the ONLY thing that moves
   * the buffer; `value` changing on its own means the caller is echoing our own
   * typing back, which must be a no-op.
   */
  revision: number;
  /** Every keystroke; the caller owns debouncing it into a save. */
  onChange: (next: string) => void;
  /** Preserve focus/caret when upgrading the immediately available plain editor. */
  initialSelection?: () => { start: number; end: number } | null;
  readOnly?: boolean;
  ariaLabel?: string;
}
export default function SourceEditor({ value, revision, onChange, initialSelection, readOnly = false, ariaLabel = 'Markup source' }: SourceEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<SourceView | null>(null);
  /** Read at replacement time, so a stale render cannot supply the text. */
  const latest = useRef(value);
  latest.current = value;
  const emit = useRef(onChange);
  emit.current = onChange;

  // Mounted once per editor: its buffer, caret and undo history live as long as the pane does.
  useEffect(() => {
    const created = createSourceView({
      parent: host.current!, doc: latest.current, readOnly, ariaLabel,
      selection: initialSelection?.() ?? null,
      onChange: (next) => emit.current(next),
    });
    view.current = created;
    return () => { created.destroy(); view.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, ariaLabel]);

  // Someone else moved the document.
  useEffect(() => { view.current?.replace(latest.current); }, [revision]);

  return <div ref={host} className="h-full" />;
}
