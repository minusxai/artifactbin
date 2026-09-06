'use client';
import RemoteMentionPicker, { type MentionPickerHandle } from './RemoteMentionPicker';

/**
 * THE WRITING HALF of markdown-lite: a textarea, a light toolbar over it, and
 * a Preview that swaps the two.
 *
 * It holds no draft of its own — the value and its setter belong to whoever
 * mounts it (the annotation composer, every reply box), so what ⌘↵ sends is
 * the same plain TEXT that was in the field a moment before. The toolbar edits
 * that text; it never produces markup, and there is no rich-text model here to
 * diverge from the string.
 *
 * Two things are load-bearing and both were learned by leaving them out:
 *
 *   · A toolbar button MUST NOT take the caret. `onMouseDown` is prevented on
 *     every one of them, because the click handler needs the selection that
 *     existed when it was pressed — blur first and "wrap the selection" wraps
 *     nothing at all.
 *   · A controlled textarea is re-rendered from its value, and React puts the
 *     caret at the END when it does. So a press stages the selection to
 *     restore and an effect puts it back after the commit; without that, every
 *     press sends the cursor to the bottom of the draft.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Bold, Code, Italic, Link2, List } from 'lucide-react';
import MarkdownLite from '@/components/MarkdownLite';
import { Tooltip } from '@/components/Tooltip';
import { wrapSelection, type MdMarker } from '@/lib/markdown-lite';
import { mentionDraft } from '@/lib/mention-draft';

export interface MarkdownFieldProps {
  /** The textarea's own accessible name — the one the page already used. */
  label: string;
  /** The rendered draft's accessible name while Preview is on. */
  previewLabel: string;
  /** "Preview comment" / "Preview reply" — the toggle's own name. */
  previewToggleLabel: string;
  value: string;
  onChange: (value: string) => void;
  /** ⌘↵. The caller decides whether the draft is sendable at all. */
  onSubmit?: () => void;
  previewing: boolean;
  onPreviewingChange: (previewing: boolean) => void;
  rows?: number;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  /**
   * Anything the caller wants ABOVE the toolbar — the composer's breadcrumb.
   * Above, deliberately: the breadcrumb says what is being commented ON, and
   * a formatting bar between the subject and its own field reads backwards.
   */
  children?: ReactNode;
}

/** ⌘B / ⌘I / ⌘E — the three every editor binds, and nothing beyond them. */
const KEYS: Record<string, MdMarker> = { b: 'bold', i: 'italic', e: 'code' };

const TOOLBAR = [
  { marker: 'bold', label: 'Bold', hint: 'bold (⌘B)', Icon: Bold },
  { marker: 'italic', label: 'Italic', hint: 'italic (⌘I)', Icon: Italic },
  { marker: 'code', label: 'Code', hint: 'code (⌘E)', Icon: Code },
  { marker: 'link', label: 'Link', hint: 'link', Icon: Link2 },
  { marker: 'list', label: 'List', hint: 'list', Icon: List },
] satisfies Array<{ marker: MdMarker; label: string; hint: string; Icon: typeof Bold }>;

const toolButton = 'inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[3px] text-muted hover:bg-surface hover:text-fg';

export default function MarkdownField({
  label, previewLabel, previewToggleLabel, value, onChange, onSubmit,
  previewing, onPreviewingChange, rows = 3, placeholder, autoFocus, className = '', children,
}: MarkdownFieldProps) {
  const [mention, setMention] = useState<{start:number;end:number;query:string}|null>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<MentionPickerHandle>(null);
  const restore = useRef<{ start: number; end: number } | null>(null);
  const draft = mentionDraft(value);

  // After the commit, never during it: the value has to be on the element
  // before a range into it means anything.
  useEffect(() => {
    const staged = restore.current;
    const field = fieldRef.current;
    if (!staged || !field) return;
    restore.current = null;
    field.focus();
    field.setSelectionRange(draft.toDisplay(staged.start), draft.toDisplay(staged.end));
  });

  const apply = useCallback((marker: MdMarker) => {
    const field = fieldRef.current;
    if (!field) return;
    const projected = mentionDraft(value);
    const next = wrapSelection(value, projected.toRaw(field.selectionStart), projected.toRaw(field.selectionEnd, 'end'), marker);
    restore.current = { start: next.start, end: next.end };
    onChange(next.text);
  }, [value, onChange]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (mention && !event.metaKey && !event.ctrlKey) {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); setMention(null); return;
      }
      if (pickerRef.current?.keyDown(event.key)) {
        event.preventDefault(); event.stopPropagation(); return;
      }
    }
    if (!event.metaKey && !event.ctrlKey) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      onSubmit?.();
      return;
    }
    const marker = KEYS[event.key.toLowerCase()];
    if (!marker) return;
    // Prevented so the browser's own bold/italic never reaches the field.
    event.preventDefault();
    apply(marker);
  }, [apply, onSubmit, mention]);

  return (
    <div className={`min-w-0 ${className}`}>
      {children}
      <div role="toolbar" aria-label={`${label} formatting`} className="mb-1 flex items-center gap-0.5">
        {TOOLBAR.map(({ marker, label: name, hint, Icon }) => (
          <Tooltip key={marker} content={hint}>
            <button
              type="button"
              aria-label={name}
              disabled={previewing}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => apply(marker)}
              className={`${toolButton} disabled:cursor-default disabled:opacity-40`}
            >
              <Icon size={13} strokeWidth={1.8} />
            </button>
          </Tooltip>
        ))}
        <Tooltip content={previewing ? 'back to writing' : 'preview markdown'}>
          <button
            type="button"
            aria-label={previewToggleLabel}
            aria-pressed={previewing}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => { setMention(null); onPreviewingChange(!previewing); }}
            className={`ml-auto cursor-pointer rounded-[3px] px-1.5 py-0.5 font-mono text-[10px] ${previewing ? 'bg-accent-soft text-accent' : 'text-faint hover:bg-surface hover:text-fg'}`}
          >
            {previewing ? 'edit' : 'preview'}
          </button>
        </Tooltip>
      </div>
      {previewing ? (
        <MarkdownLite
          text={value}
          label={previewLabel}
          className="mb-2 min-h-[3rem] w-full rounded-[4px] border border-edge bg-surface p-2 text-sm"
        />
      ) : (
        <textarea
          ref={fieldRef}
          aria-label={label}
          value={draft.text}
          onChange={(event) => {
            const text=event.target.value, end=event.target.selectionStart;
            const raw = draft.edit(text, end);
            const next = mentionDraft(raw);
            const match=text.slice(0,end).match(/(?:^|\s)@([^\s@\[\]]*)$/);
            setMention(match?{start:next.toRaw(end-match[1].length-1),end:next.toRaw(end, 'end'),query:match[1]}:null);
            onChange(raw);
          }}
          onClick={() => setMention(null)}
          onKeyDown={onKeyDown}
          rows={rows}
          autoFocus={autoFocus}
          placeholder={placeholder}
          className="mb-2 min-h-24 w-full resize-y rounded-md border border-edge bg-surface p-3 font-sans text-sm leading-relaxed placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/10"
        />
      )}
      {!previewing && mention && <RemoteMentionPicker ref={pickerRef} query={mention.query} onSelect={text=>{
        const caret=mention.start+text.length;restore.current={start:caret,end:caret};
        onChange(value.slice(0,mention.start)+text+value.slice(mention.end));setMention(null);
      }}/>}
      {!previewing && !mention && <p className="mb-2 text-[10px] text-muted">Type @ to mention an agent · Ctrl/⌘ + Enter to send</p>}
    </div>
  );
}
