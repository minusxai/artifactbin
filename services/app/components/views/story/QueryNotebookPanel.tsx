'use client';

/**
 * THE QUERY NOTEBOOK PANEL — the document's `<Query>` declarations as cells:
 * the SQL above, the last run's answer below, the way a notebook reads.
 *
 * A lens like VizEditorPanel: the cells come from the source and the editor's
 * dataflow state (lib/story/query-notebook), and the only thing a cell emits
 * is its edited SQL — committed on blur or ⌘⏎, named by query. The editor
 * writes it into the declaration and its own refresh re-runs the document, so
 * the result under the cell is always the document's, never a private run.
 *
 * A cell also names what its query POWERS — the embeds bound to it — and,
 * while the SQL has focus (or a chip is hovered), asks the editor to spotlight
 * them in the document: an outline, not a selection, so the rail stays here.
 */
import { useEffect, useRef, useState } from 'react';
import type { BoundEmbed, QueryCell } from '@/lib/story/query-notebook';
import type { TableResult } from '@/lib/story/dataflow';

export interface QueryNotebookPanelProps {
  cells: QueryCell[];
  onSqlChange: (name: string, sql: string) => void;
  /** Outline these BODY paths in the document; [] clears. Absent when nothing can be pointed at. */
  onSpotlight?: (paths: string[]) => void;
  /** The cell to land on (the chart inspector's "edit in queries"): scrolled to, its SQL focused. */
  focus?: string | null;
}

/** What a reader calls the thing: the kit's tags in plain words, the rest as written. */
const KIND: Record<string, string> = { Question: 'chart', Number: 'number', DataTable: 'table', select: 'select', Select: 'select' };
const kindOf = (tag: string) => KIND[tag] ?? tag.toLowerCase();

/** The rows a cell shows: enough to recognise the shape, few enough for the rail. */
const PREVIEW_ROWS = 10;

function SqlField({ name, sql, onCommit, onFocus, onBlur }: {
  name: string; sql: string; onCommit: (sql: string) => void; onFocus: () => void; onBlur: () => void;
}) {
  const [draft, setDraft] = useState(sql);
  const commit = () => {
    if (draft === sql || draft.trim() === '') return;
    onCommit(draft);
  };
  return (
    <textarea
      aria-label={`Query $${name} SQL`}
      spellCheck={false}
      wrap="off"
      rows={Math.min(12, Math.max(3, sql.split('\n').length + 1))}
      className="w-full resize-y overflow-auto rounded-[4px] border border-edge bg-surface p-2 font-mono text-[11px] leading-[1.5] text-fg"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={onFocus}
      onBlur={() => { commit(); onBlur(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit(); }}
    />
  );
}

/** The embeds a query powers, as chips; hovering one points at it alone. */
function Powers({ bound, onSpotlight }: { bound: BoundEmbed[]; onSpotlight: (paths: string[] | null) => void }) {
  if (bound.length === 0) return <span className="font-mono text-[11px] text-faint">powers nothing yet</span>;
  return (
    <div className="flex flex-wrap items-center gap-1 font-mono text-[11px]">
      <span className="text-faint">powers</span>
      {bound.map((b) => (
        <span
          key={b.path}
          aria-label={`Spotlight ${b.label ?? kindOf(b.tag)}`}
          onMouseEnter={() => onSpotlight([b.path])}
          onMouseLeave={() => onSpotlight(null)}
          className="inline-flex cursor-default items-baseline gap-1 rounded-[4px] border border-edge bg-raised px-1.5 py-0.5 text-fg hover:border-edge-bright"
        >
          <span>{b.label ?? kindOf(b.tag)}</span>
          {b.label && <span className="text-faint">{kindOf(b.tag)}</span>}
        </span>
      ))}
    </div>
  );
}

const cellText = (value: unknown): string =>
  value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);

function ResultTable({ name, result }: { name: string; result: TableResult }) {
  const shown = result.rows.slice(0, PREVIEW_ROWS);
  const total = result.totalRows ?? result.rows.length;
  const count = shown.length < total ? `${shown.length} of ${total} rows` : `${total} ${total === 1 ? 'row' : 'rows'}`;
  return (
    <div aria-label={`Query $${name} result`} className="flex flex-col gap-1">
      <div className="max-h-64 overflow-auto rounded-[4px] border border-edge">
        <table className="w-full border-collapse font-mono text-[11px] leading-[1.4]">
          <thead className="sticky top-0 bg-raised">
            <tr>
              {result.columns.map((c) => (
                <th key={c.name} scope="col" className="whitespace-nowrap border-b border-edge px-1.5 py-1 text-left font-normal text-muted">
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <tr key={i} className="border-b border-edge last:border-b-0">
                {result.columns.map((c) => {
                  const value = row[c.name];
                  return (
                    <td key={c.name} className={`max-w-[12rem] truncate whitespace-nowrap px-1.5 py-0.5 ${value === null || value === undefined ? 'text-faint' : 'text-fg'}`}>
                      {value === null || value === undefined ? '∅' : cellText(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span className="font-mono text-[11px] text-faint">{count}</span>
    </div>
  );
}

function Cell({ cell, onSqlChange, onSpotlight, land }: {
  cell: QueryCell; onSqlChange: QueryNotebookPanelProps['onSqlChange']; onSpotlight?: (paths: string[]) => void; land: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const section = useRef<HTMLElement>(null);
  // Landing focuses the SQL — which also spotlights what it powers, so the
  // chart the reader came from lights up in the document.
  useEffect(() => {
    if (!land) return;
    section.current?.scrollIntoView?.({ block: 'nearest' });
    section.current?.querySelector('textarea')?.focus();
  }, [land]);
  const all = cell.bound.map((b) => b.path);
  /** A chip's hover narrows to one; leaving it goes back to everything the focused SQL powers, or nothing. */
  const point = (paths: string[] | null) => onSpotlight?.(paths ?? (focused ? all : []));
  return (
    <section ref={section} aria-label={`Query $${cell.name}`} className="flex flex-col gap-1.5 py-4 first:pt-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs text-fg">${cell.name}</span>
        <span className="flex items-baseline gap-2 font-mono text-[11px] text-faint">
          {cell.source && <span>ref:{cell.source}</span>}
          {cell.params.length > 0 && <span>{cell.params.map((p) => `$${p}`).join(' ')}</span>}
        </span>
      </div>
      {/* Keyed by the declared SQL (the TitleField precedent): an edit landing from
          OUTSIDE — code mode, an agent — replaces the draft rather than fighting it. */}
      <SqlField
        key={cell.sql}
        name={cell.name}
        sql={cell.sql}
        onCommit={(sql) => onSqlChange(cell.name, sql)}
        onFocus={() => { setFocused(true); onSpotlight?.(all); }}
        onBlur={() => { setFocused(false); onSpotlight?.([]); }}
      />
      <Powers bound={cell.bound} onSpotlight={point} />
      {cell.pending ? (
        <span className="font-mono text-[11px] text-faint">running…</span>
      ) : cell.error ? (
        <p aria-label={`Query $${cell.name} error`} className="rounded-[4px] border border-red-300 bg-red-50 px-2 py-1 font-mono text-[11px] text-red-800">
          {cell.error}
        </p>
      ) : cell.result ? (
        <ResultTable name={cell.name} result={cell.result} />
      ) : (
        <span className="font-mono text-[11px] text-faint">not run yet</span>
      )}
    </section>
  );
}

export default function QueryNotebookPanel({ cells, onSqlChange, onSpotlight, focus }: QueryNotebookPanelProps) {
  return (
    // One column, a rule between cells (and above the hint): the notebook's page breaks.
    <div className="flex flex-col divide-y divide-edge" aria-label="Query notebook">
      {cells.map((cell) => (
        <Cell key={cell.name} cell={cell} onSqlChange={onSqlChange} onSpotlight={onSpotlight} land={focus === cell.name} />
      ))}
      <p className="pt-3 font-sans text-[11px] text-faint">Edits apply when you leave a cell or press ⌘⏎; the document re-runs and charts bound to the query redraw.</p>
    </div>
  );
}
