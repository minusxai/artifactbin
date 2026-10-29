/* @jsxImportSource solid-js */
/**
 *
 *
 * Pick a table, a column, an aggregation, and the decorations for an inline
 * `<Cell>` — the chart inspector's sibling for the figure that lives in a
 * sentence.
 *
 * A lens like VizEditorPanel: the source of truth stays the document, and
 * every interaction emits a PARTIAL edit (NumberEmbedEdit — only the field
 * that changed). Partial where the chart edit is whole for one reason: a
 * Number's `data` may be inline rows the panel cannot re-emit, so a column
 * pick must be expressible without restating the binding.
 */
import { createEffect, createSignal, on, Show, type JSX } from 'solid-js';
import { Input } from '@/solid/ui/Field';
import { Select } from '@/solid/ui/Select';
import BoundQuery from '../BoundQuery';
import type { TableChoice } from '@/lib/document/table-catalog';
import { NUMBER_AGGS, type NumberEmbedBinding, type NumberEmbedEdit } from '@/lib/story-edit/story-number';

interface NumberEditorPanelProps {
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
 * mode, a commit round-tripping through the parent) — discarding any in-progress local draft.
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
      <span class="font-mono text-2xs text-faint">{props.label}</span>
      <Input
        size="sm"
        type="text"
        aria-label={props.aria}
        placeholder={props.placeholder ?? '— none —'}
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
    <div class="flex flex-col gap-3" aria-label="Cell editor">
      <div class="flex flex-col gap-1">
        <span class="font-mono text-2xs text-faint">data</span>
        <Select size="sm"
          ariaLabel="Table"
          value={props.binding.table ?? ''}
          onChange={(v) => {
            if ((v || null) !== props.binding.table) props.onChange({ table: v || null });
          }}
          options={[
            { value: '', label: '— pick a table —' },
            ...props.tables.map((d) => ({ value: d.name, label: `$${d.name}` })),
            // A bound name the document does not declare — see VizEditorPanel:
            // the placeholder would claim the Cell is unbound, and the next
            // edit would write that claim into the source.
            ...(props.binding.table && !bound() ? [{ value: props.binding.table, label: `$${props.binding.table} (not declared)` }] : []),
          ]}
        />
      </div>
      <BoundQuery table={bound()} onOpenQuery={props.onOpenQuery} />
      <Show when={props.binding.table && !bound()}>
        <p class="font-sans text-2xs text-danger" aria-label="Missing table notice">
          This cell points at a table the document does not declare.
        </p>
      </Show>

      <Show
        when={bound()}
        fallback={
          // Inline rows / unbound: the columns are not catalogued anywhere, so the
          // author names one directly.
          <TextField label="column" aria="Cell column" value={props.binding.col} placeholder="— first column —" onCommit={(v) => props.onChange({ col: v })} />
        }
      >
        <div class="flex flex-col gap-1">
          <span class="font-mono text-2xs text-faint">column</span>
          <Select size="sm"
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
        <span class="font-mono text-2xs text-faint">aggregate</span>
        <Select size="sm"
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
