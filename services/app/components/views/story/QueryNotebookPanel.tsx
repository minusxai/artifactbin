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
  /** Dataset id -> its title, from the document's refs. A raw id names nothing to a person. */
  titles?: Record<string, string | null>;
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
      className="w-full resize-y overflow-auto border-0 bg-surface px-3 py-2 font-mono text-[11px] leading-[1.5] text-fg focus:outline-none"
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
  /*
   * A TITLED embed is worth naming — "Bug, feature or polish chart" tells you
   * what the query is for. Six chips all reading "number" tell you nothing six
   * times, so untitled ones collapse to a count of their kind. Hover still
   * points at them, now all at once, which is the useful half of the chip.
   */
  const titled = bound.filter((b) => b.label);
  const rest = bound.filter((b) => !b.label);
  const byKind = new Map<string, string[]>();
  for (const b of rest) {
    const kind = kindOf(b.tag);
    byKind.set(kind, [...(byKind.get(kind) ?? []), b.path]);
  }
  const chip = (key: string, text: string, sub: string | null, paths: string[]) => (
    <span
      key={key}
      aria-label={`Spotlight ${text}`}
      onMouseEnter={() => onSpotlight(paths)}
      onMouseLeave={() => onSpotlight(null)}
      className="inline-flex cursor-default items-baseline gap-1 rounded-[4px] border border-edge bg-raised px-1.5 py-0.5 text-fg hover:border-edge-bright"
    >
      <span>{text}</span>
      {sub && <span className="text-faint">{sub}</span>}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-1 font-mono text-[11px]">
      <span className="text-faint">powers</span>
      {titled.map((b) => chip(b.path, b.label!, kindOf(b.tag), [b.path]))}
      {[...byKind].map(([kind, paths]) =>
        chip(kind, paths.length === 1 ? kind : `${paths.length} ${kind}s`, null, paths),
      )}
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
    <div aria-label={`Query $${name} result`} className="flex flex-col">
      <div className="max-h-64 overflow-auto">
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
      <span className="px-3 py-1.5 font-mono text-[11px] text-faint">{count}</span>
    </div>
  );
}

function Cell({ cell, onSqlChange, onSpotlight, land, selected }: {
  cell: QueryCell; onSqlChange: QueryNotebookPanelProps['onSqlChange']; onSpotlight?: (paths: string[]) => void; land: boolean; selected: boolean;
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
  /*
   * A NOTEBOOK CELL, not a run of stacked fragments. The old shape put the
   * name, the SQL, what it powers and the result in one undifferentiated
   * column with a hairline between cells, so nothing said where a cell began,
   * which half was the question and which was the answer. Three bands do:
   * a header that names it, IN, and OUT — and the gutter labels mean you can
   * tell input from output at a glance rather than by reading.
   */
  return (
    <section
      ref={section}
      aria-label={`Query $${cell.name}`}
      /*
       * The header wears the accent because a query IS one of the named, live
       * things the accent marks everywhere else — the active view, the current
       * version. Which cell is CURRENT then needs a different signal, or every
       * header saying "current" says nothing: that is the left stripe.
       */
      className={`my-3 overflow-hidden rounded-[6px] border bg-surface ${
        selected ? 'border-accent border-l-[3px]' : 'border-edge'
      }`}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-accent/20 bg-accent-soft px-3 py-1.5">
        <span className="font-mono text-xs font-medium text-accent">${cell.name}</span>
        <Powers bound={cell.bound} onSpotlight={point} />
      </header>

      <SqlField
        key={cell.sql}
        name={cell.name}
        sql={cell.sql}
        onCommit={(sql) => onSqlChange(cell.name, sql)}
        onFocus={() => { setFocused(true); onSpotlight?.(all); }}
        onBlur={() => { setFocused(false); onSpotlight?.([]); }}
      />

      <div className="border-t border-edge">
        {cell.error ? (
          <p aria-label={`Query $${cell.name} error`} className="m-3 rounded-[4px] border border-red-300 bg-red-50 px-2 py-1 font-mono text-[11px] text-red-800">
            {cell.error}
          </p>
        ) : cell.result ? (
          <ResultTable name={cell.name} result={cell.result} />
        ) : (
          <span className="block px-3 py-2 font-mono text-[11px] text-muted">{cell.pending ? 'running…' : 'not run yet'}</span>
        )}
      </div>
    </section>
  );
}

/** A query with no `source` runs in the page itself; the index says so rather than leaving a blank group. */
const LOCAL = 'computed in the page';

/** The datasets this document reads, in the order its queries first name them. */
function sourcesOf(cells: QueryCell[]): string[] {
  const seen: string[] = [];
  for (const cell of cells) {
    const key = cell.source ?? LOCAL;
    if (!seen.includes(key)) seen.push(key);
  }
  return seen;
}

/** The row count is the first question anyone asks a query, so the index answers it unprompted. */
function countOf(cell: QueryCell): string {
  if (cell.error) return 'failed';
  if (cell.pending) return '…';
  if (!cell.result) return '—';
  const n = cell.result.totalRows ?? cell.result.rows.length;
  return new Intl.NumberFormat().format(n);
}

/**
 * The dataset's OWN shape, read from the dataset — not inferred from what its
 * queries happened to select. A union of query results mixes real columns with
 * aliases the SQL invented (`pct_open`, `avg_days`), which describes the
 * queries, not the data.
 *
 * `/a/<id>/tables` is the same door DatasetCatalogView uses, and it authorizes
 * dataset READ: a viewer who may not see the data gets nothing here either.
 */
interface DatasetShape {
  columns: string[];
  rows: number | null;
  error: string | null;
}

function useDatasetShapes(ids: string[]): Record<string, DatasetShape> {
  const [shapes, setShapes] = useState<Record<string, DatasetShape>>({});
  const key = ids.join(',');
  useEffect(() => {
    let live = true;
    for (const id of key ? key.split(',') : []) {
      void (async () => {
        try {
          const response = await fetch(`/a/${encodeURIComponent(id)}/tables`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql: 'select * from public.rows', limit: 1, offset: 0 }),
          });
          const data = await response.json();
          if (!live) return;
          if (!response.ok) {
            setShapes((prev) => ({ ...prev, [id]: { columns: [], rows: null, error: data.details?.[0] ?? data.error ?? 'unavailable' } }));
            return;
          }
          setShapes((prev) => ({
            ...prev,
            [id]: {
              columns: (data.columns ?? []).map((c: { name: string }) => c.name),
              rows: typeof data.totalRows === 'number' ? data.totalRows : null,
              error: null,
            },
          }));
        } catch {
          if (live) setShapes((prev) => ({ ...prev, [id]: { columns: [], rows: null, error: 'unavailable' } }));
        }
      })();
    }
    return () => { live = false; };
  }, [key]);
  return shapes;
}

export default function QueryNotebookPanel({ cells, onSqlChange, onSpotlight, focus, titles = {} }: QueryNotebookPanelProps) {
  const groups = sourcesOf(cells).map((key) => ({
    key,
    cells: cells.filter((c) => (c.source ?? LOCAL) === key),
  }));
  const datasets = groups.filter((g) => g.key !== LOCAL);
  // Clicking the index SELECTS as well as scrolls: a list that moves the page
  // without marking what it moved to leaves you re-finding your place.
  const [picked, setPicked] = useState<string | null>(null);
  /*
   * Refs, not document.getElementById: this panel renders inside a SHADOW ROOT,
   * so a document-wide lookup finds nothing and the click silently did not scroll.
   */
  const cellEls = useRef<Record<string, HTMLDivElement | null>>({});
  const shapes = useDatasetShapes(sourcesOf(cells).filter((k) => k !== LOCAL));
  const jump = (name: string) => {
    cellEls.current[name]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  return (
    <div className="flex gap-8" aria-label="Data and queries">
      {/*
        * THE INDEX — every dataset and every query on one screen, which is the
        * thing the old notebook could not do: it was a scroll of cells with no
        * way to see what was in it. Queries sit UNDER the dataset they read,
        * because a query is a view of a dataset the way code is a view of the
        * app, and a flat list hid that.
        */}
      <nav aria-label="Data index" className="sticky top-0 hidden w-60 shrink-0 self-start lg:block">
        {groups.map((group) => (
          <div key={group.key} className="mb-5">
            <p className="font-mono text-[11px] uppercase tracking-wide text-faint">
              {group.key === LOCAL ? 'derived' : `dataset · ${titles[group.key] ?? group.key}`}
            </p>
            {/* A bare group of names does not say what KIND of query is in it;
                one line does, and it is the difference between a round trip to
                the server and a run over rows already in the page. */}
            <p className="mb-1.5 font-sans text-[10px] leading-snug text-faint">
              {group.key === LOCAL
                ? 'runs in the page over other queries'
                : 'runs on the server'}
            </p>
            <div className="flex items-baseline justify-between gap-2 border-b border-edge px-1.5 pb-0.5 font-mono text-[10px] uppercase tracking-wide text-faint">
              <span>query</span>
              <span>rows</span>
            </div>
            {group.cells.map((cell) => (
              <button
                key={cell.name}
                type="button"
                onClick={() => { setPicked(cell.name); jump(cell.name); }}
                title={`Go to ${cell.name} — ${countOf(cell)} rows`}
                className={`flex w-full cursor-pointer items-baseline justify-between gap-2 rounded-[3px] px-1.5 py-0.5 text-left font-mono text-[11px] ${
                  (picked ?? focus) === cell.name ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-raised hover:text-fg'
                }`}
              >
                <span className="truncate">{cell.name}</span>
                <span className="shrink-0 tabular-nums text-faint">{countOf(cell)}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="min-w-0 flex-1">
        {datasets.length > 0 && (
          <section aria-label="Datasets" className="mb-6">
            <h2 className="mb-2 font-mono text-[11px] uppercase tracking-wide text-faint">datasets</h2>
            <div className="flex flex-col gap-2">
              {datasets.map((group) => (
                <div key={group.key} className="rounded-[4px] border border-edge p-3">
                  {/* The dataset is a REFERENCE, so it behaves like one: it opens. */}
                  <a
                    href={`/a/${group.key}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[12px] text-accent underline-offset-2 hover:underline"
                  >
                    {titles[group.key] ?? group.key}
                  </a>
                  {titles[group.key] && <p className="font-mono text-[10px] text-faint">{group.key}</p>}
                  <p className="mt-1 font-sans text-[11px] text-muted">
                    read by {group.cells.length} {group.cells.length === 1 ? 'query' : 'queries'} ·{' '}
                    {group.cells.map((c) => c.name).join(', ')}
                  </p>
                  {(() => {
                    const shape = shapes[group.key];
                    if (!shape) return <p className="mt-2 font-mono text-[11px] text-faint">reading its shape…</p>;
                    if (shape.error) return <p className="mt-2 font-mono text-[11px] text-faint">shape unavailable — {shape.error}</p>;
                    return (
                      <div className="mt-2">
                        <p className="font-mono text-[10px] uppercase tracking-wide text-faint">
                          public.rows · {shape.columns.length} columns
                          {shape.rows !== null && ` · ${new Intl.NumberFormat().format(shape.rows)} rows`}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {shape.columns.map((c) => (
                            <span key={c} className="rounded-[3px] bg-raised px-1.5 py-0.5 font-mono text-[10px] text-muted">{c}</span>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>
          </section>
        )}

        <section aria-label="Queries">
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-wide text-faint">queries</h2>
          <div className="flex flex-col">
            {cells.map((cell) => (
              <div
                key={cell.name}
                ref={(el) => { cellEls.current[cell.name] = el; }}
                className="scroll-mt-4"
              >
                <Cell
                  cell={cell}
                  onSqlChange={onSqlChange}
                  onSpotlight={onSpotlight}
                  land={focus === cell.name}
                  selected={(picked ?? focus) === cell.name}
                />
              </div>
            ))}
            <p className="pt-3 font-sans text-[11px] text-faint">Edits apply when you leave a cell or press ⌘⏎; the document re-runs and charts bound to the query redraw.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
