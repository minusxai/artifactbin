/* @jsxImportSource solid-js */
/**
 * The paste dialog owns its
 * keyboard boundary; insertion still belongs to the live editor.
 */
import type { JSX } from 'solid-js';
import { createDialogShell } from '@/lib/islands/kit/dialog-shell';

export default function MarkdownPasteDialog(props: {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onInsert: () => void;
}): JSX.Element {
  let panel: HTMLDivElement | undefined;
  let textarea: HTMLTextAreaElement | undefined;
  // Solid sets `autofocus` as a plain attribute; jsdom (and some browsers) never act on it, so
  // the initial focus is set explicitly, so focus lands at mount.
  createDialogShell({ panel: () => panel, onClose: () => props.onClose(), initialFocus: () => textarea, lockScroll: true, focusable: 'textarea,button:not([disabled])' });
  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label="Paste Markdown"
      class="fixed inset-x-4 top-28 z-50 mx-auto max-w-xl rounded border border-edge bg-surface p-4 shadow-xl"
    >
      <label class="block text-sm">
        Paste Markdown
        <textarea
          ref={textarea}
          aria-label="Markdown to insert"
          value={props.value}
          onInput={(e) => props.onChange(e.currentTarget.value)}
          class="mt-2 h-40 w-full rounded border border-edge bg-surface p-2 font-mono text-sm"
        />
      </label>
      <div class="mt-2 flex gap-2">
        <button type="button" onClick={props.onInsert} class="rounded border border-edge px-3 py-1">
          Insert Markdown
        </button>
        <button type="button" onClick={props.onClose} class="rounded border border-edge px-3 py-1">
          Cancel
        </button>
      </div>
    </div>
  );
}
