/* @jsxImportSource solid-js */
/**
 * Edit a `<Mermaid>` diagram's
 * source and title, the chart inspector's sibling for the drawn block. The document
 * renders the diagram as an image, so the source has no in-place editor; this panel is
 * where it is written.
 *
 * A lens like the Number inspector: the source of truth stays the document and every
 * commit emits a PARTIAL edit (MermaidEmbedEdit). Source commits on blur or ⌘⏎, never
 * per keystroke — each commit re-renders the diagram, and a half-typed line would flash
 * an error on every character.
 *
 * An edit landing from OUTSIDE the field (a remote agent, code mode) must discard a stale
 * draft: a createEffect reseeds the draft signal whenever the prop changes.
 */
import { createEffect, createSignal, Show, type JSX } from 'solid-js';
import { mermaidSourceError } from '@/lib/jsx/mermaid-source';
import type { MermaidEmbed, MermaidEmbedEdit } from '@/lib/data/story/story-mermaid';

export interface MermaidEditorPanelProps {
  embed: MermaidEmbed;
  onChange: (edit: MermaidEmbedEdit) => void;
}

/** A text field committed on blur or Enter, empty as null — the TitleField pattern. */
function TitleField(props: { value: string | null; onCommit: (value: string | null) => void }): JSX.Element {
  const [draft, setDraft] = createSignal(props.value ?? '');
  createEffect(() => setDraft(props.value ?? ''));
  const commit = () => {
    const next = draft().trim() ? draft() : null;
    if (next !== (props.value ?? null)) props.onCommit(next);
  };
  return (
    <label class="flex flex-col gap-1">
      <span class="font-mono text-[11px] text-faint">title</span>
      <input
        type="text"
        aria-label="Diagram title"
        placeholder="— none —"
        class="w-full rounded-[4px] border border-edge bg-surface px-2 py-1 font-mono text-xs text-fg"
        value={draft()}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      />
    </label>
  );
}

function SourceField(props: { code: string; onCommit: (code: string) => void }): JSX.Element {
  const [draft, setDraft] = createSignal(props.code);
  const [error, setError] = createSignal<string | null>(null);
  createEffect(() => { setDraft(props.code); setError(null); });
  const commit = () => {
    if (draft() === props.code) return;
    const refused = mermaidSourceError(draft());
    setError(refused);
    if (!refused) props.onCommit(draft());
  };
  return (
    <div class="flex flex-col gap-1">
      <span class="font-mono text-[11px] text-faint">source</span>
      <textarea
        aria-label="Diagram source"
        spellcheck={false}
        wrap="off"
        rows={16}
        class="w-full resize-y overflow-auto rounded-[4px] border border-edge bg-surface p-2 font-mono text-[11px] leading-[1.5] text-fg"
        value={draft()}
        onInput={(e) => { setDraft(e.currentTarget.value); setError(null); }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit(); }}
      />
      <Show when={error()}>
        <p class="font-sans text-[11px] text-red-500" aria-label="Diagram source error">{error()}</p>
      </Show>
      <p class="font-sans text-[11px] text-faint">Flowchart, sequence or state syntax. Applies when you leave the field or press ⌘⏎.</p>
    </div>
  );
}

export default function MermaidEditorPanel(props: MermaidEditorPanelProps): JSX.Element {
  return (
    <div class="flex flex-col gap-3" aria-label="Diagram editor">
      <TitleField value={props.embed.title} onCommit={(title) => props.onChange({ title })} />
      <SourceField code={props.embed.code} onCommit={(code) => props.onChange({ code })} />
    </div>
  );
}
