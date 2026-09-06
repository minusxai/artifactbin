import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import type { DatasetCatalog } from '@/lib/datasets/types';
import type { DatasetColumn } from '@/lib/story/dataset-shape';
import type { Row } from '@/lib/story/dataflow';

export interface CatalogPreview {
  rows: Row[];
  columns: DatasetColumn[];
  truncated?: boolean;
  refreshedAt: string;
}

/** Shared preview rendering keeps model previews and saved tables consistent. */
export function CatalogRows({ result, label = 'Table preview' }: { result: CatalogPreview; label?: string }) {
  return <div aria-label={label} className="max-h-[32rem] overflow-auto rounded border border-edge bg-surface">
    <table className="w-full border-collapse text-left font-mono text-xs">
      <thead className="sticky top-0 bg-surface"><tr>{result.columns.map(column => <th key={column.name} className="border-b border-edge px-3 py-2 font-medium whitespace-nowrap">{column.name} <span className="font-normal text-faint">{column.type}</span></th>)}</tr></thead>
      <tbody>{result.rows.map((row, index) => <tr key={index} className="odd:bg-raised/40">{result.columns.map(column => <td key={column.name} className="border-b border-edge px-3 py-2 text-muted whitespace-nowrap">{row[column.name] == null ? '—' : typeof row[column.name] === 'object' ? JSON.stringify(row[column.name]) : String(row[column.name])}</td>)}</tr>)}</tbody>
    </table>
    {!result.rows.length && <p className="p-4 text-sm text-faint">No rows returned.</p>}
  </div>;
}

const PAGE_SIZE = 50;
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const selectClass = 'rounded border border-edge bg-surface px-3 py-2 font-mono text-xs text-fg';
export type ExplorerCatalog = Pick<DatasetCatalog, 'kind' | 'defaultSchema' | 'refreshSeconds'> & { tables: Array<{ schema: string; name: string }> };
export type CatalogQuery = (sql: string, options: { limit: number; offset: number; refresh?: boolean }) => Promise<CatalogPreview>;

/** Readers query only the public catalog. Credentials and notebook SQL never enter this adapter. */
export function DatasetCatalogView({ id, catalog, canEdit }: { id: string; catalog: DatasetCatalog; canEdit: boolean }) {
  const query = useCallback<CatalogQuery>(async (sql, options) => {
    const response = await fetch(`/a/${encodeURIComponent(id)}/tables`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, ...options }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.details?.[0] ?? data.error ?? 'Could not load this query.');
    return data;
  }, [id]);
  return <DatasetExplorer catalog={catalog} query={query} editHref={canEdit ? `/datasets/${encodeURIComponent(id)}/edit` : undefined} />;
}

/** One execution cursor owns SQL, refresh and paging; editing text never changes that cursor. */
export function DatasetExplorer({ catalog, query, paginate = true, editHref }: { catalog: ExplorerCatalog; query: CatalogQuery; paginate?: boolean; editHref?: string }) {
  const [selection, setSelection] = useState(() => {
    const table = catalog.tables.find(t => t.schema === catalog.defaultSchema) ?? catalog.tables[0];
    return { schema: table?.schema ?? catalog.defaultSchema, name: table?.name ?? '', offset: 0 };
  });
  const [mode, setMode] = useState<'table' | 'sql'>('table');
  const [sqlDraft, setSqlDraft] = useState('');
  const [executedSql, setExecutedSql] = useState<string | null>(null);
  const [execution, setExecution] = useState(0);
  const [result, setResult] = useState<{ data: CatalogPreview; offset: number; table: boolean } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(Date.now());
  const consumedRefresh = useRef(0);
  const schemas = [...new Set(catalog.tables.map(t => t.schema))];
  const table = catalog.tables.find(t => t.schema === selection.schema && t.name === selection.name);
  const tableSql = table ? `SELECT * FROM ${quote(table.schema)}.${quote(table.name)}` : '';
  const sql = executedSql ?? tableSql;

  useEffect(() => {
    if (table) return;
    const fallback = catalog.tables.find(t => t.schema === catalog.defaultSchema) ?? catalog.tables[0];
    if (fallback) setSelection({ schema: fallback.schema, name: fallback.name, offset: 0 });
    else if (executedSql === null) { setResult(null); setError(''); setBusy(false); }
  }, [catalog, table, executedSql]);

  useEffect(() => {
    if (!sql) return;
    let alive = true;
    const force = refresh !== consumedRefresh.current;
    consumedRefresh.current = refresh;
    setBusy(true); setError('');
    void query(sql, { limit: PAGE_SIZE, offset: selection.offset, ...(force ? { refresh: true } : {}) })
      .then(data => { if (alive) { setResult({ data, offset: selection.offset, table: executedSql === null }); setNow(Date.now()); } })
      .catch(err => { if (alive) setError(err instanceof Error ? err.message : 'Could not load this query.'); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [catalog, query, sql, executedSql, selection.offset, refresh, execution]);

  useEffect(() => {
    if (!catalog.refreshSeconds) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [catalog.refreshSeconds]);

  const stale = Boolean(error || (result && catalog.refreshSeconds > 0 && now - Date.parse(result.data.refreshedAt) >= catalog.refreshSeconds * 1000));
  const completeStoredTable = result?.table && catalog.kind === 'stored' && result.offset === 0
    && (result.data.truncated === false || (result.data.truncated === undefined && result.data.rows.length < PAGE_SIZE));
  const choose = (schema: string, name: string) => { setResult(null); setError(''); setExecutedSql(null); setSelection({ schema, name, offset: 0 }); };
  return <section aria-label="Dataset catalog" className="mx-auto min-w-0 w-full max-w-6xl space-y-4 p-4 sm:p-6">
    <div className="flex flex-wrap items-center gap-2">
      <Button aria-label="Table view" aria-pressed={mode === 'table'} variant={mode === 'table' ? 'solid' : 'ghost'} onClick={() => { setMode('table'); choose(selection.schema, selection.name); }}>Table view</Button>
      <Button aria-label="SQL view" aria-pressed={mode === 'sql'} variant={mode === 'sql' ? 'solid' : 'ghost'} onClick={() => { setMode('sql'); if (!sqlDraft) setSqlDraft(tableSql); }}>Run SQL</Button>
      {editHref && <a aria-label="Edit dataset" href={editHref} className="ml-auto text-sm text-accent underline underline-offset-4">Edit dataset</a>}
    </div>
    {mode === 'table' ? <div className="flex flex-wrap items-end gap-3">
      <label className="grid min-w-0 gap-1 text-xs text-muted">Schema<select aria-label="Dataset schema" className={selectClass} value={selection.schema} onChange={e => choose(e.target.value, catalog.tables.find(t => t.schema === e.target.value)?.name ?? '')}>{schemas.map(schema => <option key={schema}>{schema}</option>)}</select></label>
      <label className="grid min-w-0 gap-1 text-xs text-muted">Table<select aria-label="Dataset table" className={selectClass} value={selection.name} onChange={e => choose(selection.schema, e.target.value)}>{catalog.tables.filter(t => t.schema === selection.schema).map(t => <option key={t.name}>{t.name}</option>)}</select></label>
    </div> : <div className="space-y-2">
      <label className="grid gap-2 text-xs text-muted">Query exposed tables<textarea aria-label="Dataset SQL" spellCheck={false} className="min-h-32 w-full resize-y rounded border border-edge bg-surface p-3 font-mono text-sm leading-6 text-fg focus:border-accent focus:outline-none" value={sqlDraft} onChange={e => setSqlDraft(e.target.value)} /></label>
      <p className="text-xs text-faint">Only whitelisted tables and columns are available here. Changes run when you choose Run SQL.</p>
      <Button aria-label="Run dataset SQL" disabled={busy || !sqlDraft.trim()} onClick={() => { setExecutedSql(sqlDraft.trim()); setSelection(value => ({ ...value, offset: 0 })); setExecution(n => n + 1); }}>Run SQL</Button>
    </div>}
    <div className="flex flex-wrap items-center gap-3">
      <Button aria-label="Refresh dataset" variant="ghost" disabled={busy || !sql} onClick={() => setRefresh(n => n + 1)}>{busy ? 'Loading…' : 'Refresh'}</Button>
      <p aria-label="Refresh status" aria-live="polite" className="font-mono text-xs text-faint">{result ? `Last refreshed ${new Date(result.data.refreshedAt).toLocaleString()}${stale ? ' · stale' : ''}` : busy ? 'Loading preview…' : 'No preview yet'} · {catalog.refreshSeconds ? `Refresh interval ${catalog.refreshSeconds}s` : 'Manual refresh'}</p>
    </div>
    {error && <p role="alert" aria-label="Dataset preview error" className="text-sm text-danger">{error}</p>}
    {result && <>
      <p aria-label="Dataset summary" className="font-mono text-xs text-muted">
        {result.offset > 0 && result.data.rows.length > 0
          ? `Rows ${result.offset + 1}–${result.offset + result.data.rows.length} shown`
          : `${result.data.rows.length} row${result.data.rows.length === 1 ? '' : 's'}${completeStoredTable ? '' : ' shown'}`}
        {` · ${result.data.columns.length} column${result.data.columns.length === 1 ? '' : 's'}`}
      </p>
      <CatalogRows result={result.data} />
    </>}
    {!table && mode === 'table' && <p className="text-sm text-muted">Select tables or model outputs in the whitelist to explore them.</p>}
    {result && paginate && <div className="flex items-center gap-3">
      <Button aria-label="Previous page" variant="ghost" disabled={busy || selection.offset === 0} onClick={() => setSelection(value => ({ ...value, offset: Math.max(0, value.offset - PAGE_SIZE) }))}>Previous</Button>
      <span className="font-mono text-xs text-faint">{result.data.rows.length ? `${result.offset + 1}–${result.offset + result.data.rows.length}` : '0'} rows</span>
      <Button aria-label="Next page" variant="ghost" disabled={busy || !(result.data.truncated ?? result.data.rows.length === PAGE_SIZE)} onClick={() => setSelection(value => ({ ...value, offset: value.offset + PAGE_SIZE }))}>Next</Button>
    </div>}
    {result && !paginate && result.data.truncated && <p className="text-xs text-faint">Preview is limited to 50 rows. Refine the SQL to inspect a different slice.</p>}
  </section>;
}
