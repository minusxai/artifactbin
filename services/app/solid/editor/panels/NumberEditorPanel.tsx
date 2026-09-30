/* @jsxImportSource solid-js */
/**
 * components/views/story/NumberEditorPanel.tsx in SOLID.
 *
 * Pick a table, a column, an aggregation, and the decorations for an inline
 * `<Number>` — the chart inspector's sibling for the figure that lives in a
 * sentence.
 *
 * A lens like VizEditorPanel: the source of truth stays the document, and
 * every interaction emits a PARTIAL edit (NumberEmbedEdit — only the field
 * that changed). Partial where the chart edit is whole for one reason: a
 * Number's `data` may be inline rows the panel cannot re-emit, so a column
 * pick must be expressible without restating the binding.
 */
import { createEffect, createSignal, on, Show, type JSX } from 'solid-js';
import { SelectMenu } from '@/solid/components/SelectMenu';
import BoundQuery from '../BoundQuery';
import type { TableChoice } from '@/lib/story/table-catalog';
import { NUMBER_AGGS, type NumberEmbedBinding, type NumberEmbedEdit } from '@/lib/data/story/story-number';

export interface NumberEditorPanelProps {
  binding: NumberEmbedBinding;
  /** The tables the document declares (the chart picker's list). */
  tables: TableChoice[];
  onChange: (edit: NumberEmbedEdit) => void;
  /** Open the named query in the notebook rail (InPlaceEditor); absent where there is no rail. */
  onOpenQuery?: (name: string) => void;
}

/**
 * A text field committed on blur or Enter, empty as null — the TitleField pattern.
 * Re-seeded whenever `value` changes from OUTSIDE this field (a remote agent, code
 * mode, a commit round-tripping through the parent) — mirroring the React panel's
 * `key={...}` remount, which discards any in-progress local draft.
 */
function TextField(props: {
  label: string;
  aria: string;
  value: string | null;
  placeholder?: string;
  onCommit: (value: string | null) => void;
}): JSX.Element {
  const [draft, setDraft] = createSignal(props.value ?? '');
  createEffect(on(() => props.value, (v) => setDraft(v ?? ''), { defer: true }));
  const commit = () => {
    const next = draft().trim() ? draft() : null;
    if (next !== (props.value ?? null)) props.onCommit(next);
  };
  return (
    <label class="flex flex-col gap-1">
      <span class="font-mono text-[11px] text-faint">{props.label}</span>
      <input
        type="text"
        aria-label={props.aria}
        placeholder={props.placeholder ?? '— none —'}
        class="w-full rounded-[4px] border border-edge bg-surface px-2 py-1 font-mono text-xs text-fg"
        value={draft()}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      />
    </label>
  );
}

export default function NumberEditorPanel(props: NumberEditorPanelProps): JSX.Element {
  const bound = () => (props.binding.table ? props.tables.find((d) => d.name === props.binding.table) ?? null : null);
  /** Numeric first — a figure wants a measure, but everything stays selectable. */
  const columns = () => [...(bound()?.columns ?? [])].sort((a, b) => (a.type === 'number' ? 0 : 1) - (b.type === 'number' ? 0 : 1));

  return (
    <div class="flex flex-col gap-3" aria-label="Number editor">
      <div class="flex flex-col gap-1">
        <span class="font-mono text-[11px] text-faint">data</span>
        <SelectMenu
          ariaLabel="Table"
          value={props.binding.table ?? ''}
          onChange={(v) => {
            if ((v || null) !== props.binding.table) props.onChange({ table: v || null });
          }}
          options={[
            { value: '', label: '— pick a table —' },
            ...props.tables.map((d) => ({ value: d.name, label: `$${d.name}` })),
            // A bound name the document does not declare — see VizEditorPanel:
            // the placeholder would claim the Number is unbound, and the next
            // edit would write that claim into the source.
            ...(props.binding.table && !bound() ? [{ value: props.binding.table, label: `$${props.binding.table} (not declared)` }] : []),
          ]}
        />
      </div>
      <BoundQuery table={bound()} onOpenQuery={props.onOpenQuery} />
      <Show when={props.binding.table && !bound()}>
        <p class="font-sans text-[11px] text-amber-600" aria-label="Missing table notice">
          This number points at a table the document does not declare.
        </p>
      </Show>

      <Show
        when={bound()}
        fallback={
          // Inline rows / unbound: the columns are not catalogued anywhere, so the
          // author names one directly.
          <TextField label="column" aria="Number column" value={props.binding.col} placeholder="— first column —" onCommit={(v) => props.onChange({ col: v })} />
        }
      >
        <div class="flex flex-col gap-1">
          <span class="font-mono text-[11px] text-faint">column</span>
          <SelectMenu
            ariaLabel="Column"
            value={props.binding.col ?? ''}
            onChange={(name) => { if ((name || null) !== props.binding.col) props.onChange({ col: name || null }); }}
            options={[
              { value: '', label: '— first column —' },
              ...columns().map((c) => ({ value: c.name, label: c.name, hint: c.type })),
            ]}
          />
        </div>
      </Show>

      <div class="flex flex-col gap-1">
        <span class="font-mono text-[11px] text-faint">aggregate</span>
        <SelectMenu
          ariaLabel="Aggregation"
          value={props.binding.agg ?? 'first'}
          onChange={(agg) => {
            // 'first' is InlineNumber's default — writing it would only add noise.
            const next = agg === 'first' ? null : agg;
            if (next !== props.binding.agg) props.onChange({ agg: next });
          }}
          options={NUMBER_AGGS.map((a) => ({ value: a, label: a }))}
        />
      </div>

      <TextField label="prefix" aria="Number prefix" value={props.binding.prefix} placeholder="$" onCommit={(v) => props.onChange({ prefix: v })} />
      <TextField label="suffix" aria="Number suffix" value={props.binding.suffix} placeholder="%" onCommit={(v) => props.onChange({ suffix: v })} />
      <TextField label="format" aria="Number format" value={props.binding.format} placeholder="d3-format, e.g. ,.1f" onCommit={(v) => props.onChange({ format: v })} />
    </div>
  );
}
