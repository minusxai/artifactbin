/* @jsxImportSource solid-js */
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack, type JSX } from 'solid-js';
import { ChevronDown } from 'lucide-solid';
import { Button } from './ui';
import { artifactEditPath } from '@/lib/http/urls';
import type { DatasetCatalog } from '@/lib/datasets/types';
import type { DatasetColumn } from '@/lib/dataflow/dataset-shape';
import type { Row } from '@/lib/dataflow/dataflow';
import { apiFetch } from '../lib/api';
import { dateTime } from '../lib/format';

export interface CatalogPreview { rows: Row[]; columns: DatasetColumn[]; truncated?: boolean; refreshedAt: string }
const PAGE_SIZE = 50;
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const selectClass = 'rounded border border-edge bg-surface px-3 py-2 font-mono text-xs text-fg';
type ExplorerCatalog = Pick<DatasetCatalog, 'kind' | 'defaultSchema' | 'refreshSeconds'> & { tables: Array<{ schema: string; name: string }> };
export type CatalogQuery = (sql: string, options: { limit: number; offset: number; refresh?: boolean }) => Promise<CatalogPreview>;

export function CatalogRows(props: { result: CatalogPreview; label?: string }): JSX.Element {
  return <div aria-label={props.label ?? 'Table preview'} class="max-h-[32rem] overflow-auto rounded border border-edge bg-surface">
    <table class="w-full border-collapse text-left font-mono text-xs">
      <thead class="sticky top-0 bg-surface"><tr><For each={props.result.columns}>{(column) => <th class="border-b border-edge px-3 py-2 font-medium whitespace-nowrap">{column.name} <span class="font-normal text-faint">{column.type}</span></th>}</For></tr></thead>
      <tbody><For each={props.result.rows}>{(row) => <tr class="odd:bg-raised/40"><For each={props.result.columns}>{(column) => <td class="border-b border-edge px-3 py-2 text-muted whitespace-nowrap">{row[column.name] == null ? '—' : typeof row[column.name] === 'object' ? JSON.stringify(row[column.name]) : String(row[column.name])}</td>}</For></tr>}</For></tbody>
    </table>
    <Show when={props.result.rows.length === 0}><p class="p-4 text-sm text-faint">No rows returned.</p></Show>
  </div>;
}

export function DatasetCatalogView(props: { id: string; catalog: DatasetCatalog; canEdit: boolean }): JSX.Element {
  const query: CatalogQuery = async (sql, options) => {
    const response = await apiFetch(`/a/${encodeURIComponent(props.id)}/tables`, 'POST', { sql, ...options });
    const data = await response.json();
    if (!response.ok) throw new Error(data.details?.[0] ?? data.error ?? 'Could not load this query.');
    return data;
  };
  return <DatasetExplorer catalog={props.catalog} query={query} schemaTables={props.catalog.tables} editHref={props.canEdit ? artifactEditPath(props.id) : undefined} />;
}

function DatasetSchemaBrowser(props: { tables: DatasetCatalog['tables'] }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const regionId = `dataset-schema-${Math.random().toString(36).slice(2, 8)}`;
  const schemas = () => [...new Set(props.tables.map((table) => table.schema))];
  return <div class="min-w-0 rounded border border-edge bg-surface">
    <button type="button" aria-label="Browse dataset schema" aria-expanded={open()} aria-controls={regionId} onClick={() => setOpen((value) => !value)} class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs text-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-accent">
      <span>Schema browser <span class="ml-1 text-faint">· {props.tables.length} table{props.tables.length === 1 ? '' : 's'}</span></span><ChevronDown size={14} class={open() ? 'rotate-180' : ''} />
    </button>
    <Show when={open()}><div id={regionId} aria-label="Dataset schema browser" class="grid max-h-72 gap-4 overflow-auto border-t border-edge p-3 sm:grid-cols-2">
      <Show when={schemas().length === 0}><p class="text-xs text-faint">No exposed tables.</p></Show>
      <For each={schemas()}>{(schema) => <section class="min-w-0 space-y-3">
        <h3 class="break-all font-mono text-xs font-semibold text-fg">{schema}</h3>
        <For each={props.tables.filter((table) => table.schema === schema)}>{(table) => <div class="min-w-0 border-l border-edge pl-3">
          <p class="break-all font-mono text-xs text-fg">{table.name}</p>
          <ul class="mt-1 space-y-1"><For each={table.columns}>{(column) => <li class="flex min-w-0 items-baseline justify-between gap-3 font-mono text-[11px]"><span class="min-w-0 break-all text-muted">{column.name}</span><span class="shrink-0 text-faint">{column.type}</span></li>}</For></ul>
        </div>}</For>
      </section>}</For>
    </div></Show>
  </div>;
}

export function DatasetExplorer(props: { catalog: ExplorerCatalog; query: CatalogQuery; paginate?: boolean; editHref?: string; schemaTables?: DatasetCatalog['tables'] }): JSX.Element {
  const initial = props.catalog.tables.find((table) => table.schema === props.catalog.defaultSchema) ?? props.catalog.tables[0];
  const [selection, setSelection] = createSignal({ schema: initial?.schema ?? props.catalog.defaultSchema, name: initial?.name ?? '', offset: 0 });
  const [mode, setMode] = createSignal<'table' | 'sql'>('table');
  const [sqlDraft, setSqlDraft] = createSignal('');
  const [executedSql, setExecutedSql] = createSignal<string | null>(null);
  const [execution, setExecution] = createSignal(0);
  const [result, setResult] = createSignal<{ data: CatalogPreview; offset: number; table: boolean } | null>(null);
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [refresh, setRefresh] = createSignal(0);
  const [now, setNow] = createSignal(Date.now());
  let consumedRefresh = 0;
  const schemas = () => [...new Set(props.catalog.tables.map((table) => table.schema))];
  const table = createMemo(() => props.catalog.tables.find((item) => item.schema === selection().schema && item.name === selection().name));
  const tableSql = () => table() ? `SELECT * FROM ${quote(table()!.schema)}.${quote(table()!.name)}` : '';
  const sql = () => executedSql() ?? tableSql();
  createEffect(() => {
    if (table()) return;
    const fallback = props.catalog.tables.find((item) => item.schema === props.catalog.defaultSchema) ?? props.catalog.tables[0];
    if (fallback) setSelection({ schema: fallback.schema, name: fallback.name, offset: 0 });
    else if (executedSql() === null) { setResult(null); setError(''); setBusy(false); }
  });
  createEffect(() => {
    const querySql = sql(); const offset = selection().offset; const force = refresh() !== consumedRefresh;
    execution();
    if (!querySql) return;
    consumedRefresh = refresh();
    let alive = true;
    setBusy(true); setError('');
    void untrack(() => props.query(querySql, { limit: PAGE_SIZE, offset, ...(force ? { refresh: true } : {}) }))
      .then((data) => { if (alive) { setResult({ data, offset, table: executedSql() === null }); setNow(Date.now()); } })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : 'Could not load this query.'); })
      .finally(() => { if (alive) setBusy(false); });
    onCleanup(() => { alive = false; });
  });
  createEffect(() => {
    if (!props.catalog.refreshSeconds) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => window.clearInterval(timer));
  });
  const stale = () => Boolean(error() || (result() && props.catalog.refreshSeconds > 0 && now() - Date.parse(result()!.data.refreshedAt) >= props.catalog.refreshSeconds * 1000));
  const completeStoredTable = () => Boolean(result()?.table && props.catalog.kind === 'stored' && result()?.offset === 0 && (result()?.data.truncated === false || (result()?.data.truncated === undefined && result()!.data.rows.length < PAGE_SIZE)));
  const choose = (schema: string, name: string) => { setResult(null); setError(''); setExecutedSql(null); setSelection({ schema, name, offset: 0 }); };
  return <section aria-label="Dataset catalog" class="mx-auto min-w-0 w-full max-w-6xl space-y-4 p-4 sm:p-6">
    <div class="flex flex-wrap items-center gap-2">
      <Button aria-label="Table view" aria-pressed={mode() === 'table'} variant={mode() === 'table' ? 'solid' : 'ghost'} onClick={() => { setMode('table'); choose(selection().schema, selection().name); }}>Table view</Button>
      <Button aria-label="SQL view" aria-pressed={mode() === 'sql'} variant={mode() === 'sql' ? 'solid' : 'ghost'} onClick={() => { setMode('sql'); if (!sqlDraft()) setSqlDraft(tableSql()); }}>Run SQL</Button>
      <Show when={props.editHref}><a aria-label="Edit dataset" href={props.editHref} class="ml-auto text-sm text-accent underline underline-offset-4">Edit dataset</a></Show>
    </div>
    <Show when={props.schemaTables}><DatasetSchemaBrowser tables={props.schemaTables!} /></Show>
    <Show when={mode() === 'table'} fallback={<div class="space-y-2">
      <label class="grid gap-2 text-xs text-muted">Query exposed tables<textarea aria-label="Dataset SQL" spellcheck={false} class="min-h-32 w-full resize-y rounded border border-edge bg-surface p-3 font-mono text-sm leading-6 text-fg focus:border-accent focus:outline-none" value={sqlDraft()} onInput={(event) => setSqlDraft(event.currentTarget.value)} /></label>
      <p class="text-xs text-faint">Only whitelisted tables and columns are available here. Changes run when you choose Run SQL.</p>
      <Button aria-label="Run dataset SQL" disabled={busy() || !sqlDraft().trim()} onClick={() => { setExecutedSql(sqlDraft().trim()); setSelection((value) => ({ ...value, offset: 0 })); setExecution((n) => n + 1); }}>Run SQL</Button>
    </div>}><div class="flex flex-wrap items-end gap-3">
      <label class="grid min-w-0 gap-1 text-xs text-muted">Schema<select aria-label="Dataset schema" class={selectClass} value={selection().schema} onChange={(event) => choose(event.currentTarget.value, props.catalog.tables.find((item) => item.schema === event.currentTarget.value)?.name ?? '')}><For each={schemas()}>{(schema) => <option>{schema}</option>}</For></select></label>
      <label class="grid min-w-0 gap-1 text-xs text-muted">Table<select aria-label="Dataset table" class={selectClass} value={selection().name} onChange={(event) => choose(selection().schema, event.currentTarget.value)}><For each={props.catalog.tables.filter((item) => item.schema === selection().schema)}>{(item) => <option>{item.name}</option>}</For></select></label>
    </div></Show>
    <div class="flex flex-wrap items-center gap-3">
      <Button aria-label="Refresh dataset" variant="ghost" disabled={busy() || !sql()} onClick={() => setRefresh((n) => n + 1)}>{busy() ? 'Loading…' : 'Refresh'}</Button>
      <p aria-label="Refresh status" aria-live="polite" class="font-mono text-xs text-faint">{result() ? `Last refreshed ${dateTime(result()!.data.refreshedAt)}${stale() ? ' · stale' : ''}` : busy() ? 'Loading preview…' : 'No preview yet'} · {props.catalog.refreshSeconds ? `Refresh interval ${props.catalog.refreshSeconds}s` : 'Manual refresh'}</p>
    </div>
    <Show when={error()}><p role="alert" aria-label="Dataset preview error" class="text-sm text-danger">{error()}</p></Show>
    <Show when={result()}>{(answer) => <>
      <p aria-label="Dataset summary" class="font-mono text-xs text-muted">{answer().offset > 0 && answer().data.rows.length > 0 ? `Rows ${answer().offset + 1}–${answer().offset + answer().data.rows.length} shown` : `${answer().data.rows.length} row${answer().data.rows.length === 1 ? '' : 's'}${completeStoredTable() ? '' : ' shown'}`} · {answer().data.columns.length} column{answer().data.columns.length === 1 ? '' : 's'}</p>
      <CatalogRows result={answer().data} />
    </>}</Show>
    <Show when={!table() && mode() === 'table'}><p class="text-sm text-muted">Select tables or model outputs in the whitelist to explore them.</p></Show>
    <Show when={props.paginate !== false ? result() : null}>{(answer) => <div class="flex items-center gap-3">
      <Button aria-label="Previous page" variant="ghost" disabled={busy() || selection().offset === 0} onClick={() => setSelection((value) => ({ ...value, offset: Math.max(0, value.offset - PAGE_SIZE) }))}>Previous</Button>
      <span class="font-mono text-xs text-faint">{answer().data.rows.length ? `${answer().offset + 1}–${answer().offset + answer().data.rows.length}` : '0'} rows</span>
      <Button aria-label="Next page" variant="ghost" disabled={busy() || !(answer().data.truncated ?? answer().data.rows.length === PAGE_SIZE)} onClick={() => setSelection((value) => ({ ...value, offset: value.offset + PAGE_SIZE }))}>Next</Button>
    </div>}</Show>
    <Show when={result() && props.paginate === false && result()?.data.truncated}><p class="text-xs text-faint">Preview is limited to 50 rows. Refine the SQL to inspect a different slice.</p></Show>
  </section>;
}
