'use client';
import { useRef } from 'react';
import { useDialogKeyboard } from '@/components/use-dialog-keyboard';

/** The paste dialog owns its keyboard boundary; insertion still belongs to the live editor. */
export default function MarkdownPasteDialog({
  value,
  onChange,
  onClose,
  onInsert,
}: {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onInsert: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useDialogKeyboard(panel, onClose, 'textarea,button:not([disabled])');
  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label="Paste Markdown"
      className="fixed inset-x-4 top-28 z-50 mx-auto max-w-xl rounded border border-edge bg-surface p-4 shadow-xl"
    >
      <label className="block text-sm">
        Paste Markdown
        <textarea
          autoFocus
          aria-label="Markdown to insert"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-2 h-40 w-full rounded border border-edge bg-surface p-2 font-mono text-sm"
        />
      </label>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={onInsert} className="rounded border border-edge px-3 py-1">
          Insert Markdown
        </button>
        <button type="button" onClick={onClose} className="rounded border border-edge px-3 py-1">
          Cancel
        </button>
      </div>
    </div>
  );
}
