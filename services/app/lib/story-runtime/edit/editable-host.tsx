'use client';

/**
 * A text host, made editable in the document the reader is already looking at.
 *
 * The memo comparator is the render-during-edit guard: while this host has
 * focus it reports props "equal", so React never reconciles the focused
 * subtree and an upstream re-render — a query result landing, an embed
 * re-measuring — cannot clobber half-typed text.
 *
 * `bodyEpoch` is what stops that guard from also swallowing a NEW BODY. A
 * re-render carrying the same document is the case the guard exists for; one
 * carrying a different document is an agent's write, and it must reach the
 * paragraph the cursor is parked in — that is exactly the node an agent is
 * most likely to be editing. (Learned the hard way: the canvas shipped without
 * it and an agent's edit could not reach a focused paragraph at all.)
 *
 * Handlers are gated to the host itself (`target === currentTarget`) so bubbled
 * focus/input from nested markup never double-commits.
 */
import { cloneElement, memo, type FocusEvent, type FormEvent, type ReactElement } from 'react';

export interface EditableHostSession {
  isEditing(path: string): boolean;
  onFocus(path: string, el: HTMLElement): void;
  onInput(path: string): void;
  onBlur(path: string): void;
}

export interface EditableHostProps {
  path: string;
  session: EditableHostSession;
  /** Which document this render is of — see the comparator. */
  bodyEpoch: number;
  children: ReactElement<Record<string, unknown>>;
}

export const EditableHost = memo(function EditableHost({ path, session, children }: EditableHostProps) {
  const gate = <E extends { target: EventTarget; currentTarget: EventTarget }>(fn: (e: E) => void) =>
    (e: E) => { if (e.target === e.currentTarget) fn(e); };
  return cloneElement(children, {
    contentEditable: true,
    suppressContentEditableWarning: true,
    onFocus: gate((e: FocusEvent<HTMLElement>) => session.onFocus(path, e.currentTarget)),
    onInput: gate((_e: FormEvent<HTMLElement>) => session.onInput(path)),
    onBlur: gate((_e: FocusEvent<HTMLElement>) => session.onBlur(path)),
  });
}, (prev, next) => prev.bodyEpoch === next.bodyEpoch && next.session.isEditing(next.path));
