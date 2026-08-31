'use client';

/**
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
import { useState } from 'react';
import { SelectMenu } from '@/components/SelectMenu';
import type { TableChoice } from '@/lib/story/table-catalog';
import { NUMBER_AGGS, type NumberEmbedBinding, type NumberEmbedEdit } from '@/lib/data/story/story-number';

export interface NumberEditorPanelProps {
  binding: NumberEmbedBinding;
  /** The tables the document declares (the chart picker's list). */
  tables: TableChoice[];
  onChange: (edit: NumberEmbedEdit) => void;
}

/** A text field committed on blur or Enter, empty as null — the TitleField pattern. */
function TextField({ label, aria, value, placeholder, onCommit }: {
  label: string;
  aria: string;
  value: string | null;
  placeholder?: string;
  onCommit: (value: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const commit = () => {
    const next = draft.trim() ? draft : null;
    if (next !== (value ?? null)) onCommit(next);
  };
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[11px] text-faint">{label}</span>
      <input
        type="text"
        aria-label={aria}
        placeholder={placeholder ?? '— none —'}
        className="w-full rounded-[4px] border border-edge bg-surface px-2 py-1 font-mono text-xs text-fg"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      />
    </label>
  );
}

export default function NumberEditorPanel({ binding, tables, onChange }: NumberEditorPanelProps) {
  const bound = binding.table ? tables.find((d) => d.name === binding.table) ?? null : null;
  /** Numeric first — a figure wants a measure, but everything stays selectable. */
  const columns = [...(bound?.columns ?? [])].sort((a, b) => (a.type === 'number' ? 0 : 1) - (b.type === 'number' ? 0 : 1));

  return (
    <div className="flex flex-col gap-3" aria-label="Number editor">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[11px] text-faint">data</span>
        <SelectMenu
          ariaLabel="Table"
          value={binding.table ?? ''}
          onChange={(v) => {
            if ((v || null) !== binding.table) onChange({ table: v || null });
          }}
          options={[
            { value: '', label: '— pick a table —' },
            ...tables.map((d) => ({ value: d.name, label: `$${d.name}` })),
            // A bound name the document does not declare — see VizEditorPanel:
            // the placeholder would claim the Number is unbound, and the next
            // edit would write that claim into the source.
            ...(binding.table && !bound ? [{ value: binding.table, label: `$${binding.table} (not declared)` }] : []),
          ]}
        />
      </div>
      {binding.table && !bound && (
        <p className="font-sans text-[11px] text-amber-600" aria-label="Missing table notice">
          This number points at a table the document does not declare.
        </p>
      )}

      {bound ? (
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[11px] text-faint">column</span>
          <SelectMenu
            ariaLabel="Column"
            value={binding.col ?? ''}
            onChange={(name) => { if ((name || null) !== binding.col) onChange({ col: name || null }); }}
            options={[
              { value: '', label: '— first column —' },
              ...columns.map((c) => ({ value: c.name, label: c.name, hint: c.type })),
            ]}
          />
        </div>
      ) : (
        // Inline rows / unbound: the columns are not catalogued anywhere, so the
        // author names one directly.
        <TextField key={`c:${binding.col ?? ''}`} label="column" aria="Number column" value={binding.col} placeholder="— first column —" onCommit={(v) => onChange({ col: v })} />
      )}

      <div className="flex flex-col gap-1">
        <span className="font-mono text-[11px] text-faint">aggregate</span>
        <SelectMenu
          ariaLabel="Aggregation"
          value={binding.agg ?? 'first'}
          onChange={(agg) => {
            // 'first' is InlineNumber's default — writing it would only add noise.
            const next = agg === 'first' ? null : agg;
            if (next !== binding.agg) onChange({ agg: next });
          }}
          options={NUMBER_AGGS.map((a) => ({ value: a, label: a }))}
        />
      </div>

      {/* Keyed by the prop (the TitleField precedent): an edit landing from OUTSIDE the
          field — a remote agent, code mode — re-seeds the draft rather than letting a
          stale draft quietly revert it on the next blur. */}
      <TextField key={`p:${binding.prefix ?? ''}`} label="prefix" aria="Number prefix" value={binding.prefix} placeholder="$" onCommit={(v) => onChange({ prefix: v })} />
      <TextField key={`s:${binding.suffix ?? ''}`} label="suffix" aria="Number suffix" value={binding.suffix} placeholder="%" onCommit={(v) => onChange({ suffix: v })} />
      <TextField key={`f:${binding.format ?? ''}`} label="format" aria="Number format" value={binding.format} placeholder="d3-format, e.g. ,.1f" onCommit={(v) => onChange({ format: v })} />
    </div>
  );
}
