/* @jsxImportSource solid-js */
/**
 * The document's `<Query>`
 * declarations as cells: the SQL above, the last run's answer below, the way a
 * notebook reads.
 *
 * A lens like VizEditorPanel: the cells come from the source and the editor's
 * dataflow state (lib/story/data/query-notebook), and the only thing a cell emits
 * is its edited SQL — committed on blur or ⌘⏎, named by query. The editor
 * writes it into the declaration and its own refresh re-runs the document, so
 * the result under the cell is always the document's, never a private run.
 *
 * A cell also names what its query POWERS — the embeds bound to it — and,
 * while the SQL has focus (or a chip is hovered), asks the editor to spotlight
 * them in the document: an outline, not a selection, so the rail stays here.
 *
 * There is no artifact-backend context in the app, so `backend` is an explicit
 * prop — same precedent as solid/editor/EditPanel's `historyUnavailable`. Whoever wires this panel into
 * a live page passes the artifact's backend.
 */
import { createEffect, createSignal, For, on, onCleanup, Show, type JSX } from 'solid-js';
import type { BoundEmbed, QueryCell } from '@/lib/story/data/query-notebook';
import type { TableResult } from '@/lib/dataflow/dataflow';
import { BackendRequestError } from '@/lib/artifact-backend/errors';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { formatCount } from '../../lib/format';

export interface QueryNotebookPanelProps {
  cells: QueryCell[];
  onSqlChange: (name: string, sql: string) => void;
  /** Outline these BODY paths in the document; [] clears. Absent when nothing can be pointed at. */
  onSpotlight?: (paths: string[]) => void;
  /** The cell to land on (the chart inspector's "edit in queries"): scrolled to, its SQL focused. */
  focus?: string | null;
  /** Dataset id -> its title, from the document's refs. A raw id names nothing to a person. */
  titles?: Record<string, string | null>;
  /** See DEVIATION above. */
  backend: ArtifactBackend;
}

/** What a reader calls the thing: the kit's tags in plain words, the rest as written. */
const KIND: Record<string, string> = { Question: 'chart', Number: 'number', DataTable: 'table', select: 'select', Select: 'select' };
const kindOf = (tag: string) => KIND[tag] ?? tag.toLowerCase();

/** The rows a cell shows: enough to recognise the shape, few enough for the rail. */
const PREVIEW_ROWS = 10;

/**
 * A textarea committed on blur or ⌘⏎. Re-seeded whenever `sql` changes from
 * OUTSIDE this field (a reseed, not a remount).
 */
function SqlField(props: { name: string; sql: string; onCommit: (sql: string) => void; onFocus: () => void; onBlur: () => void }): JSX.Element {
  const [draft, setDraft] = createSignal(props.sql);
  createEffect(on(() => props.sql, (v) => setDraft(v), { defer: true }));
  const commit = () => {
    if (draft() === props.sql || draft().trim() === '') return;
    props.onCommit(draft());
  };
  return (
    <textarea
      aria-label={`Query $${props.name} SQL`}
      spellcheck={false}
      wrap="off"
      rows={Math.min(12, Math.max(3, props.sql.split('\n').length + 1))}
      class="w-full resize-y overflow-auto border-0 bg-surface px-3 py-2 font-mono text-[11px] leading-[1.5] text-fg focus:outline-none"
      value={draft()}
      onInput={(e) => setDraft(e.currentTarget.value)}
      onFocus={props.onFocus}
      onBlur={() => { commit(); props.onBlur(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit(); }}
    />
  );
}

/** The embeds a query powers, as chips; hovering one points at it alone. */
function Powers(props: { bound: BoundEmbed[]; onSpotlight: (paths: string[] | null) => void }): JSX.Element {
  /*
   * A TITLED embed is worth naming — "Bug, feature or polish chart" tells you
   * what the query is for. Six chips all reading "number" tell you nothing six
   * times, so untitled ones collapse to a count of their kind. Hover still
   * points at them, now all at once, which is the useful half of the chip.
   */
  const titled = () => props.bound.filter((b) => b.label);
  const rest = () => props.bound.filter((b) => !b.label);
  const byKind = () => {
    const map = new Map<string, string[]>();
    for (const b of rest()) {
      const kind = kindOf(b.tag);
      map.set(kind, [...(map.get(kind) ?? []), b.path]);
    }
    return [...map];
  };
  const chip = (text: string, sub: string | null, paths: string[]) => (
    <span
      aria-label={`Spotlight ${text}`}
      onMouseEnter={() => props.onSpotlight(paths)}
      onMouseLeave={() => props.onSpotlight(null)}
      class="inline-flex cursor-default items-baseline gap-1 rounded-[4px] border border-edge bg-raised px-1.5 py-0.5 text-fg hover:border-edge-bright"
    >
      <span>{text}</span>
      <Show when={sub}>{(s) => <span class="text-faint">{s()}</span>}</Show>
    </span>
  );
  return (
    <Show
      when={props.bound.length > 0}
      fallback={<span class="font-mono text-[11px] text-faint">powers nothing yet</span>}
    >
      <div class="flex flex-wrap items-center gap-1 font-mono text-[11px]">
        <span class="text-faint">powers</span>
        <For each={titled()}>{(b) => chip(b.label!, kindOf(b.tag), [b.path])}</For>
        <For each={byKind()}>{([kind, paths]) => chip(paths.length === 1 ? kind : `${paths.length} ${kind}s`, null, paths)}</For>
      </div>
    </Show>
  );
}

const cellText = (value: unknown): string =>
  value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);

function ResultTable(props: { name: string; result: TableResult }): JSX.Element {
  const shown = () => props.result.rows.slice(0, PREVIEW_ROWS);
  const total = () => props.result.totalRows ?? props.result.rows.length;
  const count = () => (shown().length < total() ? `${shown().length} of ${total()} rows` : `${total()} ${total() === 1 ? 'row' : 'rows'}`);
  return (
    <div aria-label={`Query $${props.name} result`} class="flex flex-col">
      <div class="max-h-64 overflow-auto">
        <table class="w-full border-collapse font-mono text-[11px] leading-[1.4]">
          <thead class="sticky top-0 bg-raised">
            <tr>
              <For each={props.result.columns}>
                {(c) => <th scope="col" class="whitespace-nowrap border-b border-edge px-1.5 py-1 text-left font-normal text-muted">{c.name}</th>}
              </For>
            </tr>
          </thead>
          <tbody>
            <For each={shown()}>
              {(row) => (
                <tr class="border-b border-edge last:border-b-0">
                  <For each={props.result.columns}>
                    {(c) => {
                      const value = row[c.name];
                      return (
                        <td class={`max-w-[12rem] truncate whitespace-nowrap px-1.5 py-0.5 ${value === null || value === undefined ? 'text-faint' : 'text-fg'}`}>
                          {value === null || value === undefined ? '∅' : cellText(value)}
                        </td>
                      );
                    }}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      <span class="px-3 py-1.5 font-mono text-[11px] text-faint">{count()}</span>
    </div>
  );
}

function Cell(props: {
  cell: QueryCell; onSqlChange: QueryNotebookPanelProps['onSqlChange']; onSpotlight?: (paths: string[]) => void; land: boolean; selected: boolean;
}): JSX.Element {
  const [focused, setFocused] = createSignal(false);
  let section: HTMLElement | undefined;
  // Landing focuses the SQL — which also spotlights what it powers, so the
  // chart the reader came from lights up in the document.
  createEffect(() => {
    if (!props.land) return;
    section?.scrollIntoView?.({ block: 'nearest' });
    section?.querySelector('textarea')?.focus();
  });
  const all = () => props.cell.bound.map((b) => b.path);
  /** A chip's hover narrows to one; leaving it goes back to everything the focused SQL powers, or nothing. */
  const point = (paths: string[] | null) => props.onSpotlight?.(paths ?? (focused() ? all() : []));
  /*
   * A NOTEBOOK CELL, not a run of stacked fragments. Three bands: a header that
   * names it, IN, and OUT — the gutter labels mean you can tell input from
   * output at a glance rather than by reading.
   */
  return (
    <section
      ref={(el) => { section = el; }}
      aria-label={`Query $${props.cell.name}`}
      /*
       * The header wears the accent because a query IS one of the named, live
       * things the accent marks everywhere else — the active view, the current
       * version. Which cell is CURRENT then needs a different signal, or every
       * header saying "current" says nothing: that is the left stripe.
       */
      class={`my-3 overflow-hidden rounded-[6px] border bg-surface ${props.selected ? 'border-accent border-l-[3px]' : 'border-edge'}`}
    >
      <header class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-accent/20 bg-accent-soft px-3 py-1.5">
        <span class="font-mono text-xs font-medium text-accent">${props.cell.name}</span>
        <Powers bound={props.cell.bound} onSpotlight={point} />
      </header>

      <SqlField
        name={props.cell.name}
        sql={props.cell.sql}
        onCommit={(sql) => props.onSqlChange(props.cell.name, sql)}
        onFocus={() => { setFocused(true); props.onSpotlight?.(all()); }}
        onBlur={() => { setFocused(false); props.onSpotlight?.([]); }}
      />

      <div class="border-t border-edge">
        <Show
          when={props.cell.error}
          fallback={
            <Show
              when={props.cell.result}
              fallback={<span class="block px-3 py-2 font-mono text-[11px] text-muted">{props.cell.pending ? 'running…' : 'not run yet'}</span>}
            >
              {(result) => <ResultTable name={props.cell.name} result={result()} />}
            </Show>
          }
        >
          {(error) => (
            <p aria-label={`Query $${props.cell.name} error`} class="m-3 rounded-[4px] border border-red-300 bg-red-50 px-2 py-1 font-mono text-[11px] text-red-800">
              {error()}
            </p>
          )}
        </Show>
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
  return formatCount(n);
}

interface DatasetShape {
  columns: string[];
  rows: number | null;
  error: string | null;
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
function useDatasetShapes(backend: () => ArtifactBackend, ids: () => string[]): () => Record<string, DatasetShape> {
  const [shapes, setShapes] = createSignal<Record<string, DatasetShape>>({});
  createEffect(() => {
    const b = backend();
    const list = ids();
    const unavailable = b.unavailable('runQueries');
    let live = true;
    for (const id of list) {
      if (unavailable) {
        setShapes((prev) => ({ ...prev, [id]: { columns: [], rows: null, error: unavailable } }));
        continue;
      }
      void (async () => {
        try {
          const data = await b.queryTable(id, { sql: 'select * from public.rows', limit: 1, offset: 0 });
          if (!live) return;
          setShapes((prev) => ({
            ...prev,
            [id]: {
              columns: (data.columns ?? []).map((c: { name: string }) => c.name),
              rows: typeof data.totalRows === 'number' ? data.totalRows : null,
              error: null,
            },
          }));
        } catch (error) {
          if (live) setShapes((prev) => ({ ...prev, [id]: { columns: [], rows: null, error: error instanceof BackendRequestError ? error.message : 'unavailable' } }));
        }
      })();
    }
    onCleanup(() => { live = false; });
  });
  return shapes;
}

export default function QueryNotebookPanel(props: QueryNotebookPanelProps): JSX.Element {
  const titles = () => props.titles ?? {};
  const groups = () => sourcesOf(props.cells).map((key) => ({ key, cells: props.cells.filter((c) => (c.source ?? LOCAL) === key) }));
  const datasets = () => groups().filter((g) => g.key !== LOCAL);
  // Clicking the index SELECTS as well as scrolls: a list that moves the page
  // without marking what it moved to leaves you re-finding your place.
  const [picked, setPicked] = createSignal<string | null>(null);
  /*
   * Plain refs, not document.getElementById: this panel renders inside a SHADOW
   * ROOT, so a document-wide lookup finds nothing and the click silently did not
   * scroll.
   */
  const cellEls: Record<string, HTMLDivElement | undefined> = {};
  const datasetIds = () => sourcesOf(props.cells).filter((k) => k !== LOCAL);
  const shapes = useDatasetShapes(() => props.backend, datasetIds);
  const jump = (name: string) => {
    cellEls[name]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  return (
    <div class="flex gap-8" aria-label="Data and queries">
      {/*
        * THE INDEX — every dataset and every query on one screen, which is the
        * thing the old notebook could not do: it was a scroll of cells with no
        * way to see what was in it. Queries sit UNDER the dataset they read,
        * because a query is a view of a dataset the way code is a view of the
        * app, and a flat list hid that.
        */}
      <nav aria-label="Data index" class="sticky top-0 hidden w-60 shrink-0 self-start lg:block">
        <For each={groups()}>
          {(group) => (
            <div class="mb-5">
              <p class="font-mono text-[11px] uppercase tracking-wide text-faint">
                {group.key === LOCAL ? 'derived' : `dataset · ${titles()[group.key] ?? group.key}`}
              </p>
              {/* A bare group of names does not say what KIND of query is in it;
                  one line does, and it is the difference between a round trip to
                  the server and a run over rows already in the page. */}
              <p class="mb-1.5 font-sans text-[10px] leading-snug text-faint">
                {group.key === LOCAL ? 'runs in the page over other queries' : 'runs on the server'}
              </p>
              <div class="flex items-baseline justify-between gap-2 border-b border-edge px-1.5 pb-0.5 font-mono text-[10px] uppercase tracking-wide text-faint">
                <span>query</span>
                <span>rows</span>
              </div>
              <For each={group.cells}>
                {(cell) => (
                  <button
                    type="button"
                    onClick={() => { setPicked(cell.name); jump(cell.name); }}
                    title={`Go to ${cell.name} — ${countOf(cell)} rows`}
                    class={`flex w-full cursor-pointer items-baseline justify-between gap-2 rounded-[3px] px-1.5 py-0.5 text-left font-mono text-[11px] ${
                      (picked() ?? props.focus) === cell.name ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-raised hover:text-fg'
                    }`}
                  >
                    <span class="truncate">{cell.name}</span>
                    <span class="shrink-0 tabular-nums text-faint">{countOf(cell)}</span>
                  </button>
                )}
              </For>
            </div>
          )}
        </For>
      </nav>

      <div class="min-w-0 flex-1">
        <Show when={datasets().length > 0}>
          <section aria-label="Datasets" class="mb-6">
            <h2 class="mb-2 font-mono text-[11px] uppercase tracking-wide text-faint">datasets</h2>
            <div class="overflow-x-auto rounded-[4px] border border-edge">
              <table aria-label="Datasets" class="w-full border-collapse text-left font-mono text-xs">
                <thead class="bg-raised text-[11px] text-muted">
                  <tr>
                    <For each={['Dataset', 'Rows', 'Columns', 'Used by']}>
                      {(label) => <th scope="col" class="border-b border-edge px-3 py-2 font-medium">{label}</th>}
                    </For>
                  </tr>
                </thead>
                <tbody>
                  <For each={datasets()}>
                    {(group) => {
                      const shape = () => shapes()[group.key];
                      return (
                        <tr class="border-b border-edge align-top last:border-b-0">
                          <th scope="row" class="px-3 py-3 text-left font-normal">
                            <a href={`/a/${group.key}`} target="_blank" rel="noreferrer" class="text-accent underline-offset-2 hover:underline">{titles()[group.key] ?? group.key}</a>
                            <Show when={titles()[group.key]}><p class="mt-1 text-[10px] text-faint">{group.key}</p></Show>
                          </th>
                          <td class="whitespace-nowrap px-3 py-3 tabular-nums text-muted">
                            {shape()?.rows !== null && shape()?.rows !== undefined ? formatCount(shape()!.rows!) : '—'}
                          </td>
                          <td class="px-3 py-3 text-muted">{!shape() ? 'reading its shape…' : shape()!.error ? `shape unavailable — ${shape()!.error}` : shape()!.columns.join(', ')}</td>
                          <td class="px-3 py-3 text-muted">{group.cells.map((cell) => cell.name).join(', ')}</td>
                        </tr>
                      );
                    }}
                  </For>
                </tbody>
              </table>
            </div>
          </section>
        </Show>

        <section aria-label="Queries">
          <h2 class="mb-2 font-mono text-[11px] uppercase tracking-wide text-faint">queries</h2>
          <div class="flex flex-col">
            <For each={props.cells}>
              {(cell) => (
                <div ref={(el) => { cellEls[cell.name] = el; }} class="scroll-mt-4">
                  <Cell
                    cell={cell}
                    onSqlChange={props.onSqlChange}
                    onSpotlight={props.onSpotlight}
                    land={props.focus === cell.name}
                    selected={(picked() ?? props.focus) === cell.name}
                  />
                </div>
              )}
            </For>
            <p class="pt-3 font-sans text-[11px] text-faint">Edits apply when you leave a cell or press ⌘⏎; the document re-runs and charts bound to the query redraw.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
