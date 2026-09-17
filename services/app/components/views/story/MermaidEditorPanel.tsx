'use client';

/**
 * Edit a `<Mermaid>` diagram's source and title — the chart inspector's sibling
 * for the drawn block. The document renders the diagram as an image, so the
 * source has no in-place editor; this panel is where it is written.
 *
 * A lens like NumberEditorPanel: the source of truth stays the document and
 * every commit emits a PARTIAL edit (MermaidEmbedEdit). Source commits on blur
 * or ⌘⏎, never per keystroke — each commit re-renders the diagram, and a
 * half-typed line would flash an error on every character.
 */
import { useState } from 'react';
import { mermaidSourceError } from '@/lib/story-ui/mermaid-source';
import type { MermaidEmbed, MermaidEmbedEdit } from '@/lib/data/story/story-mermaid';

export interface MermaidEditorPanelProps {
  embed: MermaidEmbed;
  onChange: (edit: MermaidEmbedEdit) => void;
}

/** A text field committed on blur or Enter, empty as null — the TitleField pattern. */
function TitleField({ value, onCommit }: { value: string | null; onCommit: (value: string | null) => void }) {
  const [draft, setDraft] = useState(value ?? '');
  const commit = () => {
    const next = draft.trim() ? draft : null;
    if (next !== (value ?? null)) onCommit(next);
  };
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[11px] text-faint">title</span>
      <input
        type="text"
        aria-label="Diagram title"
        placeholder="— none —"
        className="w-full rounded-[4px] border border-edge bg-surface px-2 py-1 font-mono text-xs text-fg"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      />
    </label>
  );
}

function SourceField({ code, onCommit }: { code: string; onCommit: (code: string) => void }) {
  const [draft, setDraft] = useState(code);
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    if (draft === code) return;
    const refused = mermaidSourceError(draft);
    setError(refused);
    if (!refused) onCommit(draft);
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[11px] text-faint">source</span>
      <textarea
        aria-label="Diagram source"
        spellCheck={false}
        wrap="off"
        rows={16}
        className="w-full resize-y overflow-auto rounded-[4px] border border-edge bg-surface p-2 font-mono text-[11px] leading-[1.5] text-fg"
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setError(null); }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit(); }}
      />
      {error && (
        <p className="font-sans text-[11px] text-red-500" aria-label="Diagram source error">{error}</p>
      )}
      <p className="font-sans text-[11px] text-faint">Flowchart, sequence or state syntax. Applies when you leave the field or press ⌘⏎.</p>
    </div>
  );
}

export default function MermaidEditorPanel({ embed, onChange }: MermaidEditorPanelProps) {
  return (
    <div className="flex flex-col gap-3" aria-label="Diagram editor">
      {/* Keyed by the prop (the TitleField precedent): an edit landing from OUTSIDE the
          field — a remote agent, code mode — re-seeds the draft rather than letting a
          stale draft quietly revert it on the next blur. */}
      <TitleField key={`t:${embed.title ?? ''}`} value={embed.title} onCommit={(title) => onChange({ title })} />
      <SourceField key={`c:${embed.code}`} code={embed.code} onCommit={(code) => onChange({ code })} />
    </div>
  );
}
