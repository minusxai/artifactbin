import { useEffect, useRef, useState } from 'react';
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
  return <div aria-label={label} className="max-h-[32rem] overflow-auto rounded border border-edge">
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

/** Readers query only the catalog's public tables through its own access boundary. */
export function DatasetCatalogView({ id, catalog, canEdit }: { id: string; catalog: DatasetCatalog; canEdit: boolean }) {
  const [selection, setSelection] = useState(() => {
    const table = catalog.tables.find(t => t.schema === catalog.defaultSchema) ?? catalog.tables[0];
    return { schema: table?.schema ?? catalog.defaultSchema, name: table?.name ?? '', offset: 0 };
  });
  const [result, setResult] = useState<CatalogPreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(Date.now());
  const consumedRefresh = useRef(0);
  const schemas = [...new Set(catalog.tables.map(t => t.schema))];
  const table = catalog.tables.find(t => t.schema === selection.schema && t.name === selection.name);

  useEffect(() => {
    if (table) return;
    const fallback = catalog.tables.find(t => t.schema === catalog.defaultSchema) ?? catalog.tables[0];
    setResult(null); setError(''); setBusy(false);
    if (fallback) setSelection({ schema: fallback.schema, name: fallback.name, offset: 0 });
  }, [catalog, table]);

  useEffect(() => {
    if (!table) return;
    let alive = true;
    const force = refresh !== consumedRefresh.current;
    consumedRefresh.current = refresh;
    setBusy(true); setError('');
    void fetch(`/a/${encodeURIComponent(id)}/tables`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: `SELECT * FROM ${quote(table.schema)}.${quote(table.name)}`, limit: PAGE_SIZE, offset: selection.offset, ...(force ? { refresh: true } : {}) }),
    }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.details?.[0] ?? data.error ?? 'Could not load this table.');
      if (alive) { setResult(data); setNow(Date.now()); }
    }).catch(err => { if (alive) setError(err instanceof Error ? err.message : 'Could not load this table.'); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [id, catalog, table?.schema, table?.name, selection.offset, refresh]);

  useEffect(() => {
    if (!catalog.refreshSeconds) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [catalog.refreshSeconds]);

  const stale = Boolean(error || (result && catalog.refreshSeconds > 0 && now - Date.parse(result.refreshedAt) >= catalog.refreshSeconds * 1000));
  const completeStoredTable = result && catalog.kind === 'stored' && selection.offset === 0
    && (result.truncated === false || (result.truncated === undefined && result.rows.length < PAGE_SIZE));
  const choose = (schema: string, name: string, offset = 0) => { setResult(null); setError(''); setSelection({ schema, name, offset }); };
  return <section aria-label="Dataset catalog" className="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6">
    <div className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-xs text-muted">Schema<select aria-label="Dataset schema" className={selectClass} value={selection.schema} onChange={e => choose(e.target.value, catalog.tables.find(t => t.schema === e.target.value)?.name ?? '')}>{schemas.map(schema => <option key={schema}>{schema}</option>)}</select></label>
      <label className="grid gap-1 text-xs text-muted">Table<select aria-label="Dataset table" className={selectClass} value={selection.name} onChange={e => choose(selection.schema, e.target.value)}>{catalog.tables.filter(t => t.schema === selection.schema).map(t => <option key={t.name}>{t.name}</option>)}</select></label>
      <Button aria-label="Refresh dataset" variant="ghost" disabled={busy || !table} onClick={() => setRefresh(n => n + 1)}>{busy ? 'Loading…' : 'Refresh'}</Button>
      {canEdit && <a aria-label="Edit dataset" href={`/datasets/${encodeURIComponent(id)}/edit`} className="ml-auto text-sm text-accent underline underline-offset-4">Edit dataset</a>}
    </div>
    <p aria-label="Refresh status" aria-live="polite" className="font-mono text-xs text-faint">{result ? `Last refreshed ${new Date(result.refreshedAt).toLocaleString()}${stale ? ' · stale' : ''}` : busy ? 'Loading preview…' : 'No preview yet'} · {catalog.refreshSeconds ? `Refresh interval ${catalog.refreshSeconds}s` : 'Manual refresh'}</p>
    {error && <p role="alert" aria-label="Dataset preview error" className="text-sm text-danger">{error}</p>}
    {result && <>
      <p aria-label="Dataset summary" className="font-mono text-xs text-muted">
        {selection.offset > 0 && result.rows.length > 0
          ? `Rows ${selection.offset + 1}–${selection.offset + result.rows.length} shown`
          : `${result.rows.length} row${result.rows.length === 1 ? '' : 's'}${completeStoredTable ? '' : ' shown'}`}
        {` · ${result.columns.length} column${result.columns.length === 1 ? '' : 's'}`}
      </p>
      <CatalogRows result={result} />
    </>}
    {!table && <p className="text-sm text-muted">This dataset has no exposed tables.</p>}
    {result && <div className="flex items-center gap-3">
      <Button aria-label="Previous page" variant="ghost" disabled={busy || selection.offset === 0} onClick={() => choose(selection.schema, selection.name, Math.max(0, selection.offset - PAGE_SIZE))}>Previous</Button>
      <span className="font-mono text-xs text-faint">{result.rows.length ? `${selection.offset + 1}–${selection.offset + result.rows.length}` : '0'} rows</span>
      <Button aria-label="Next page" variant="ghost" disabled={busy || !(result.truncated ?? result.rows.length === PAGE_SIZE)} onClick={() => choose(selection.schema, selection.name, selection.offset + PAGE_SIZE)}>Next</Button>
    </div>}
  </section>;
}
