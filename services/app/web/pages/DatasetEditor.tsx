import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate, useParams } from 'react-router';
import { ChevronDown, ChevronRight, Database, Plus, Play, Code2 } from 'lucide-react';
import { Button, Input, PANEL } from '@/components/ui';
import { CatalogRows, DatasetExplorer, type CatalogPreview, type CatalogQuery } from '@/components/DatasetCatalogView';
import { DatasetWhitelist, type SourceDraft } from '@/components/DatasetWhitelist';
import { parseDatasetDefinition, serializeDatasetDefinition } from '@/lib/datasets/definition';
import type { CatalogInput, DatasetCatalog, DatasetConnection, DiscoveredTable, NotebookCell } from '@/lib/datasets/types';
import type { DatasetColumn } from '@/lib/story/dataset-shape';
import type { Row } from '@/lib/story/dataflow';
import { useRouter } from '@/lib/navigation';
import { useSession } from '@/web/session';

type ModelDraft = { cell: NotebookCell; schema: string; columns: DatasetColumn[]; selected: string[]; stale: boolean; collapsed: boolean; legacy: boolean; preview?: CatalogPreview };
type StoredDraft = { key: string; schema: string; name: string; rows: string; retained: boolean };
const initialConnection = (): DatasetConnection => ({ host: '', port: 5432, database: '', username: '', passwordSecretId: '', ssl: true });
const control = 'w-full rounded border border-edge bg-surface px-3 py-2 font-mono text-sm text-fg focus:border-accent focus:outline-none';
const sourceKey = (table: { schema: string; name: string }) => JSON.stringify([table.schema, table.name]);
const namesToColumns = (names: string[] = []): DatasetColumn[] => names.map(name => ({ name, type: 'string' }));
function Field({ name, children }: { name: string; children: ReactNode }) { return <label className="grid min-w-0 gap-1.5 text-xs text-muted">{name}{children}</label>; }
async function request<T>(url: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(url, body === undefined ? { credentials: 'same-origin' } : { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.details?.[0] ?? data.error ?? 'The request failed.');
  return data as T;
}

/** Visual authoring and source share one definition boundary. Passwords never enter the definition. */
export function DatasetEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { session } = useSession();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<DatasetCatalog['kind']>('stored');
  const [connection, setConnection] = useState(initialConnection);
  const [password, setPassword] = useState('');
  const [sources, setSources] = useState<SourceDraft[]>([]);
  const [models, setModels] = useState<ModelDraft[]>([]);
  const [stored, setStored] = useState<StoredDraft[]>([]);
  const [defaultSchema, setDefaultSchema] = useState('');
  const [refreshSeconds, setRefreshSeconds] = useState(0);
  const [version, setVersion] = useState<number>();
  const [loading, setLoading] = useState(Boolean(id));
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sourceText, setSourceText] = useState<string | null>(null);

  const loadDefinition = (input: CatalogInput, metadata?: DatasetCatalog, preserveDraft = false) => {
    setKind(input.kind); setConnection(input.connection ?? initialConnection()); setPassword('');
    setDefaultSchema(input.defaultSchema ?? 'public'); setRefreshSeconds(input.refreshSeconds ?? 0);
    const sameConnection = JSON.stringify(input.connection) === JSON.stringify(connection);
    const discoveries = metadata?.notebookSources ?? (preserveDraft && sameConnection ? sources.map(s => s.discovery) : []);
    const physical = input.tables.filter(t => t.source).map(t => {
      const discovery = discoveries.find(d => d.schema === t.source!.schema && d.name === t.source!.table);
      const shape = metadata?.tables.find(d => d.schema === t.schema && d.name === t.name)?.columns ?? namesToColumns(t.columns);
      return { discovery: discovery ?? { schema: t.source!.schema, name: t.source!.table, columns: shape }, included: true, schema: t.schema, name: t.name, columns: t.columns ?? shape.map(c => c.name) };
    });
    setSources([...physical, ...discoveries.filter(d => !physical.some(s => sourceKey(s.discovery) === sourceKey(d))).map(discovery => ({ discovery, included: false, schema: discovery.schema, name: discovery.name, columns: [] }))]);
    const notebookCells = input.notebook?.cells ?? [];
    const notebook = notebookCells.map((cell, index) => {
      const table = input.tables.find(t => t.modelCellId === cell.id);
      const prefixUnchanged = notebookCells.slice(0, index + 1).every((candidate, i) => {
        const previous = models.filter(m => !m.legacy)[i]?.cell;
        return previous && candidate.id === previous.id && candidate.name === previous.name && candidate.sql === previous.sql;
      });
      const previous = preserveDraft && sameConnection && prefixUnchanged ? models.find(m => m.cell.id === cell.id) : undefined;
      const columns = preserveDraft ? previous?.columns ?? [] : metadata?.tables.find(t => t.modelCellId === cell.id)?.columns ?? [];
      const stale = preserveDraft ? !previous || previous.stale || Boolean(table?.columns?.some(name => !columns.some(c => c.name === name))) : !table;
      return { cell, schema: table?.schema ?? 'models', columns, selected: table?.columns ?? [], stale, collapsed: previous?.collapsed ?? false, legacy: false, ...(previous && !stale ? { preview: previous.preview } : {}) };
    });
    const legacy = input.tables.filter(t => t.sql !== undefined).map(t => ({ cell: { id: crypto.randomUUID(), name: t.name, sql: t.sql! }, schema: t.schema, columns: metadata?.tables.find(d => d.schema === t.schema && d.name === t.name)?.columns ?? namesToColumns(t.columns), selected: t.columns ?? metadata?.tables.find(d => d.schema === t.schema && d.name === t.name)?.columns.map(c => c.name) ?? [], stale: false, collapsed: false, legacy: true }));
    setModels([...notebook, ...legacy]);
    setStored(input.tables.filter(t => !t.source && t.sql === undefined && !t.modelCellId).map(t => ({ key: crypto.randomUUID(), schema: t.schema, name: t.name, rows: t.rows ? JSON.stringify(t.rows, null, 2) : '', retained: t.rows === undefined })));
  };

  useEffect(() => {
    if (!id) return;
    let alive = true;
    void request<{ title: string; version: number; meta: { catalog?: DatasetCatalog }; source?: string }>(`/api/my/artifacts/${encodeURIComponent(id)}`).then(data => {
      if (!alive) return;
      const catalog = data.meta.catalog;
      if (!catalog) throw new Error('This artifact does not have a dataset catalog.');
      setTitle(data.title ?? ''); setVersion(data.version);
      loadDefinition({ ...catalog, tables: catalog.tables.map(({ objectKey: _, ...table }) => ({ ...table, columns: table.columns.map(c => c.name) })) }, catalog);
    }).catch(err => { if (alive) { setError(err.message); setLoadFailed(true); } }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  const run = async (operation: string, action: () => Promise<void>) => {
    setBusy(operation); setError(''); setNotice('');
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : 'Could not reach the server.'); } finally { setBusy(''); }
  };
  const invalidate = (items: ModelDraft[], from: number) => items.map((item, index) => index >= from ? { ...item, stale: true, preview: undefined } : item);
  const updateModel = (index: number, patch: Partial<NotebookCell>) => setModels(items => invalidate(items.map((item, i) => i === index ? { ...item, cell: { ...item.cell, ...patch } } : item), index));
  const addModel = (after = models.length - 1) => setModels(items => {
    const next = invalidate(items, after + 1);
    let suffix = 1; while (items.some(item => item.cell.name === `query_${suffix}`)) suffix++;
    next.splice(after + 1, 0, { cell: { id: crypto.randomUUID(), name: `query_${suffix}`, sql: '' }, schema: kind === 'postgres' ? 'models' : defaultSchema || 'public', columns: [], selected: [], stale: true, collapsed: false, legacy: kind === 'stored' });
    return next;
  });
  const updateConnection = (patch: Partial<DatasetConnection>) => {
    setConnection(value => ({ ...value, ...patch, passwordSecretId: '' })); setModels(items => invalidate(items, 0));
  };
  const ensureConnection = async () => {
    if (!connection.host.trim() || !connection.database.trim() || !connection.username.trim() || !Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535) throw new Error('Enter a host, port, database and username.');
    if (connection.passwordSecretId) return connection;
    if (!password) throw new Error('Enter a password for this connection. Changing the destination requires a replacement password.');
    const { passwordSecretId: _, ...destination } = connection;
    const data = await request<{ secret: { id: string } }>('/api/my/secrets', { value: password, connection: destination, ...(id ? { datasetId: id } : {}) });
    const configured = { ...connection, passwordSecretId: data.secret.id };
    setConnection(configured); setPassword(''); return configured;
  };
  const notebook = () => ({ cells: models.filter(m => !m.legacy).map(m => m.cell) });
  const buildCatalog = (configured = connection, validate = true): CatalogInput => {
    const tables: CatalogInput['tables'] = kind === 'postgres' ? sources.filter(s => s.included && s.columns.length).map(s => ({ schema: s.schema, name: s.name, source: { schema: s.discovery.schema, table: s.discovery.name }, columns: s.columns })) : stored.map(s => {
      if (!s.rows.trim() && s.retained) return { schema: s.schema, name: s.name };
      let rows: unknown;
      try { rows = JSON.parse(s.rows); } catch { throw new Error(`Enter a JSON array of rows for ${s.name || 'the stored table'}.`); }
      if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Stored rows must be a JSON array of objects.');
      return { schema: s.schema, name: s.name, rows: rows as Row[] };
    });
    for (const model of models) {
      if (!model.selected.length && !model.legacy) continue;
      if (validate && model.stale) throw new Error(`Run ${model.cell.name || 'the model'} again before saving or querying its exposed output.`);
      if (model.legacy) tables.push({ schema: model.schema, name: model.cell.name, sql: model.cell.sql });
      else tables.push({ schema: model.schema, name: model.cell.name, modelCellId: model.cell.id, columns: model.selected });
    }
    if (validate) {
      if (!tables.length) throw new Error('Expose at least one table or model output.');
      if (tables.some(t => !t.schema.trim() || !t.name.trim())) throw new Error('Every table needs a schema and name.');
      if (new Set(tables.map(sourceKey)).size !== tables.length) throw new Error('Table names must be unique within a schema.');
      if (!defaultSchema || !tables.some(t => t.schema === defaultSchema)) throw new Error('Choose a default schema containing an exposed table.');
      if (!Number.isInteger(refreshSeconds) || refreshSeconds < 0) throw new Error('Refresh interval must be a whole number of seconds, or 0 for manual refresh.');
    }
    return { kind, ...(kind === 'postgres' ? { connection: configured, notebook: notebook() } : {}), defaultSchema, refreshSeconds, tables };
  };
  const runCell = (index: number) => void run(`cell-${models[index].cell.id}`, async () => {
    const model = models[index];
    if (!model.cell.name.trim() || !model.cell.sql.trim()) throw new Error('Give this cell a name and a SQL query.');
    const allCells = notebook().cells;
    const cells = allCells.slice(0, allCells.findIndex(cell => cell.id === model.cell.id) + 1);
    if (new Set(cells.map(c => c.name)).size !== cells.length || cells.some(c => !c.name.trim())) throw new Error('Give every notebook cell a unique name.');
    const preview = model.legacy
      ? await request<CatalogPreview>('/api/my/datasets/preview', { dataset: buildCatalog(connection, false), sql: model.cell.sql, ...(id ? { datasetId: id } : {}) })
      : await request<CatalogPreview>('/api/my/datasets/notebook/preview', { connection: await ensureConnection(), notebook: { cells }, cellId: model.cell.id, ...(id ? { datasetId: id } : {}) });
    setModels(items => items.map(item => item.cell.id === model.cell.id ? { ...item, preview, columns: preview.columns, selected: item.legacy && !item.selected.length ? preview.columns.map(c => c.name) : item.selected.filter(name => preview.columns.some(c => c.name === name)), stale: false } : item));
  });
  const discover = () => void run('discover', async () => {
    const configured = await ensureConnection();
    const data = await request<{ tables: DiscoveredTable[] }>('/api/my/datasets/discover', { connection: configured, ...(id ? { datasetId: id } : {}) });
    setSources(current => {
      const discovered = data.tables.map(discovery => {
        const previous = current.find(s => sourceKey(s.discovery) === sourceKey(discovery));
        // A disappeared selected leaf stays explicit until the editor removes it or the server validates it.
        const missing = previous?.discovery.columns.filter(column => previous.columns.includes(column.name) && !discovery.columns.some(c => c.name === column.name)) ?? [];
        return { discovery: { ...discovery, columns: [...discovery.columns, ...missing] }, schema: previous?.schema ?? discovery.schema, name: previous?.name ?? discovery.name, included: previous?.included ?? false, columns: previous?.columns ?? [] };
      });
      return [...discovered, ...current.filter(previous => previous.included && !data.tables.some(d => sourceKey(d) === sourceKey(previous.discovery)))];
    });
    setNotice(`Connected. Found ${data.tables.length} tables. Choose what to expose below.`);
  });
  const exposures: SourceDraft[] = [...sources, ...models.filter(m => !m.legacy).map(m => ({ discovery: { schema: m.schema, name: m.cell.name || 'Untitled cell', columns: m.stale ? [] : m.columns }, schema: m.schema, name: m.cell.name, columns: m.selected, included: m.selected.length > 0, modelCellId: m.cell.id, stale: m.stale }))];
  const changeExposures = (next: SourceDraft[]) => {
    setSources(next.filter(s => !s.modelCellId));
    setModels(items => items.map(item => {
      const entry = next.find(s => s.modelCellId === item.cell.id);
      return entry && !item.stale ? { ...item, selected: entry.included ? entry.columns : [] } : item;
    }));
  };
  const exposedTables = useMemo(() => [
    ...(kind === 'postgres' ? sources.filter(s => s.included && s.columns.length).map(s => ({ schema: s.schema, name: s.name })) : stored.filter(s => s.schema && s.name).map(s => ({ schema: s.schema, name: s.name }))),
    ...models.filter(m => !m.stale && (m.selected.length || m.legacy)).map(m => ({ schema: m.schema, name: m.cell.name })),
  ], [kind, sources, stored, models]);
  const exposedTableKey = JSON.stringify(exposedTables);
  // Notebook presentation and hidden SQL drafts do not change the explorer's table catalog.
  const explorerCatalog = useMemo(() => ({ kind, defaultSchema, refreshSeconds, tables: exposedTables }), [kind, defaultSchema, refreshSeconds, exposedTableKey]);
  // Use the latest draft at execution time; typing source/cell SQL does not itself execute final SQL.
  const queryDraft = useRef<(sql: string) => Promise<CatalogPreview>>(null!);
  queryDraft.current = async sql => request<CatalogPreview>('/api/my/datasets/preview', { dataset: buildCatalog(), sql, ...(id ? { datasetId: id } : {}) });
  const previewDraft = useCallback<CatalogQuery>(sql => queryDraft.current(sql), []);
  const selectedSchemas = [...new Set(exposedTables.map(t => t.schema))];

  if (session && !session.user) return <Navigate to={`/login?callbackUrl=${encodeURIComponent(id ? `/datasets/${id}/edit` : '/datasets/new')}`} replace />;
  return <main className="mx-auto w-full min-w-0 max-w-5xl space-y-6 px-4 py-8 sm:px-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><a aria-label="Back to assets" href="/assets" className="text-xs text-muted hover:text-fg">← Assets</a><h1 className="mt-3 text-2xl font-semibold tracking-tight text-fg">{id ? 'Edit dataset' : 'Create dataset'}</h1><p className="mt-2 max-w-xl text-sm text-muted">Connect your data, shape it with SQL, and choose what readers can query.</p></div><Database className="mt-6 text-faint" size={24} /></header>
    {error && <p role="alert" aria-label="Dataset error" className="rounded border border-danger/30 bg-danger-soft p-3 text-sm text-danger">{error}</p>}
    {notice && <p role="status" aria-label="Dataset notice" className="text-sm text-accent">{notice}</p>}
    {loading ? <p className="text-sm text-muted">Loading dataset…</p> : loadFailed ? <p className="text-sm text-muted">The dataset could not be opened for editing.</p> : <>
      <fieldset disabled={Boolean(busy) || sourceText !== null} className="min-w-0 space-y-6">
        <Field name="Dataset title"><Input aria-label="Dataset title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Weekly sales" /></Field>
        <div className="flex gap-2"><Button aria-label="Stored tables" aria-pressed={kind === 'stored'} variant={kind === 'stored' ? 'solid' : 'ghost'} disabled={Boolean(id)} onClick={() => setKind('stored')}>Stored tables</Button><Button aria-label="PostgreSQL" aria-pressed={kind === 'postgres'} variant={kind === 'postgres' ? 'solid' : 'ghost'} disabled={Boolean(id)} onClick={() => setKind('postgres')}>PostgreSQL</Button></div>
        {kind === 'postgres' ? <section aria-label="Dataset connection" className={`${PANEL} space-y-4 p-4 sm:p-5`}>
          <div><h2 className="text-sm font-semibold text-fg">1. Connection</h2><p className="mt-1 text-xs text-muted">Use a database account with read access. The password is stored securely and cannot be retrieved.</p></div>
          <div className="grid gap-4 sm:grid-cols-[1fr_7rem]"><Field name="Host"><Input aria-label="Host" autoComplete="off" placeholder="db.example.com" value={connection.host} onChange={e => updateConnection({ host: e.target.value })} /></Field><Field name="Port"><Input aria-label="Port" type="number" min={1} max={65535} value={connection.port} onChange={e => updateConnection({ port: Number(e.target.value) })} /></Field></div>
          <div className="grid gap-4 sm:grid-cols-2"><Field name="Database"><Input aria-label="Database" autoComplete="off" value={connection.database} onChange={e => updateConnection({ database: e.target.value })} /></Field><Field name="Username"><Input aria-label="Username" autoComplete="off" value={connection.username} onChange={e => updateConnection({ username: e.target.value })} /></Field></div>
          {connection.passwordSecretId ? <div className="flex items-center gap-3"><span aria-label="Password status" className="text-xs text-muted">Password · Configured</span><Button aria-label="Replace password" variant="ghost" onClick={() => { setConnection(value => ({ ...value, passwordSecretId: '' })); setPassword(''); }}>Replace</Button></div> : <Field name="Password"><Input aria-label="Password" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></Field>}
          <div className="flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 text-xs text-muted"><input aria-label="Use SSL" type="checkbox" className="accent-accent" checked={connection.ssl} onChange={e => updateConnection({ ssl: e.target.checked })} />Use SSL / TLS</label><Button aria-label="Test and discover" variant="ghost" onClick={discover}>{busy === 'discover' ? 'Connecting…' : 'Test and discover'}</Button></div>
        </section> : <section aria-label="Stored tables editor" className={`${PANEL} space-y-4 p-4 sm:p-5`}>
          <div><h2 className="text-sm font-semibold text-fg">Stored tables</h2><p className="mt-1 text-xs text-muted">Add JSON rows to a named table. Existing rows are retained unless you replace them.</p></div>
          {stored.map((table, index) => <div key={table.key} className="space-y-3 border-t border-edge pt-4"><div className="grid gap-3 sm:grid-cols-2"><Field name="Schema"><Input aria-label={`Stored schema ${index + 1}`} disabled={table.retained} value={table.schema} onChange={e => setStored(items => items.map(s => s.key === table.key ? { ...s, schema: e.target.value } : s))} /></Field><Field name="Table name"><Input aria-label={`Stored table name ${index + 1}`} disabled={table.retained} value={table.name} onChange={e => setStored(items => items.map(s => s.key === table.key ? { ...s, name: e.target.value } : s))} /></Field></div><Field name={table.retained ? 'Replace rows (optional)' : 'Rows'}><textarea aria-label={`Stored rows ${index + 1}`} className={`${control} min-h-32`} spellCheck={false} value={table.rows} placeholder='[{"id": 1}]' onChange={e => setStored(items => items.map(s => s.key === table.key ? { ...s, rows: e.target.value } : s))} /></Field><Button aria-label={`Remove stored table ${index + 1}`} variant="ghost" onClick={() => setStored(items => items.filter(s => s.key !== table.key))}>Remove table</Button></div>)}
          <Button aria-label="Add stored table" variant="ghost" onClick={() => setStored(items => [...items, { key: crypto.randomUUID(), schema: defaultSchema || 'public', name: '', rows: '', retained: false }])}>Add stored table</Button>
        </section>}
        <section aria-label="Data models notebook" className={`${PANEL} overflow-hidden`}>
          <header className="border-b border-edge p-4 sm:p-5"><h2 className="text-sm font-semibold text-fg">{kind === 'postgres' ? '2. ' : ''}Data models notebook</h2><p className="mt-1 text-xs leading-5 text-muted">{kind === 'postgres' ? 'Read raw tables using schema.table, for example public.orders. Later cells can reference an earlier cell by its name. Expose only the outputs readers need.' : 'Save SQL queries over your stored tables as named model tables.'}</p></header>
          <div className="space-y-4 p-3 sm:p-4">
            {!models.length && <div className="rounded border border-dashed border-edge p-5 text-center"><Code2 size={20} className="mx-auto mb-2 text-faint" /><p className="text-sm text-muted">Start with a query, build on it in the next cell.</p><p className="mt-1 text-xs text-faint">Optional — you can expose raw tables directly.</p></div>}
            {models.map((model, index) => <article key={model.cell.id} aria-label={`Notebook cell ${index + 1}`} className="min-w-0 overflow-hidden rounded border border-edge bg-bg/30">
              <header className="flex flex-wrap items-center gap-2 border-b border-edge bg-raised/30 p-2.5">
                <button type="button" aria-label={`Collapse cell ${index + 1}`} aria-expanded={!model.collapsed} className="rounded p-1 text-muted hover:text-fg" onClick={() => setModels(items => items.map(m => m.cell.id === model.cell.id ? { ...m, collapsed: !m.collapsed } : m))}>{model.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}</button>
                <span className="font-mono text-xs text-faint">{String(index + 1).padStart(2, '0')}</span><Input aria-label={`Cell name ${index + 1}`} className="min-w-24 max-w-64 flex-1 bg-transparent text-xs" placeholder="model_name" value={model.cell.name} onChange={e => updateModel(index, { name: e.target.value })} />
                {!model.legacy && <label className="ml-auto flex items-center gap-2 text-xs text-muted"><input aria-label={`Expose cell ${index + 1}`} type="checkbox" className="accent-accent" disabled={model.stale || !model.columns.length} checked={!model.stale && model.selected.length === model.columns.length && model.columns.length > 0} aria-checked={!model.stale && model.selected.length > 0 && model.selected.length < model.columns.length ? 'mixed' : !model.stale && model.selected.length > 0} ref={node => { if (node) node.indeterminate = !model.stale && model.selected.length > 0 && model.selected.length < model.columns.length; }} onChange={e => setModels(items => items.map(m => m.cell.id === model.cell.id ? { ...m, selected: e.target.checked ? m.columns.map(c => c.name) : [] } : m))} />Expose</label>}
                <Button aria-label={`Run cell ${index + 1}`} variant="ghost" disabled={!model.cell.name.trim() || !model.cell.sql.trim()} onClick={() => runCell(index)} className="inline-flex items-center gap-1.5"><Play size={12} />Run</Button>
              </header>
              {!model.collapsed && <div className="space-y-3 p-3">
                {model.legacy && <Field name="Model schema"><Input aria-label={`Model schema ${index + 1}`} value={model.schema} onChange={e => setModels(items => items.map(m => m.cell.id === model.cell.id ? { ...m, schema: e.target.value } : m))} /></Field>}
                <textarea aria-label={`Cell SQL ${index + 1}`} spellCheck={false} className={`${control} min-h-36 resize-y border-transparent bg-transparent leading-6`} placeholder={index ? `SELECT * FROM ${models[index - 1].cell.name || 'previous_cell'}` : 'SELECT * FROM public.orders'} value={model.cell.sql} onChange={e => updateModel(index, { sql: e.target.value })} />
                {model.preview ? <CatalogRows result={model.preview} label={`Cell preview ${index + 1}`} /> : <p className="text-xs text-faint">{model.stale ? 'Run this cell to inspect its current output columns.' : `${model.columns.length} saved output columns · run to preview rows`}</p>}
                <div className="flex flex-wrap justify-between gap-2"><Button aria-label={`Insert cell after ${index + 1}`} variant="ghost" className="inline-flex items-center gap-1" onClick={() => addModel(index)}><Plus size={12} />Insert cell below</Button><Button aria-label={`Remove cell ${index + 1}`} variant="ghost" onClick={() => setModels(items => invalidate(items.filter(m => m.cell.id !== model.cell.id), index))}>Remove</Button></div>
              </div>}
            </article>)}
            <Button aria-label="Add notebook cell" variant="ghost" className="inline-flex items-center gap-1.5" onClick={() => addModel()}><Plus size={14} />Add SQL cell</Button>
          </div>
        </section>
        {kind === 'postgres' && <DatasetWhitelist sources={exposures} onChange={changeExposures} />}
        <div className="grid gap-4 sm:grid-cols-2"><Field name="Default schema"><select aria-label="Default schema" disabled={Boolean(id)} className={control} value={defaultSchema} onChange={e => setDefaultSchema(e.target.value)}><option value="">Choose explicitly</option>{[...new Set([...selectedSchemas, ...(defaultSchema ? [defaultSchema] : [])])].map(schema => <option key={schema}>{schema}</option>)}</select></Field><Field name="Refresh interval (seconds, 0 = manual)"><Input aria-label="Refresh interval" type="number" min={0} step={1} value={refreshSeconds} onChange={e => setRefreshSeconds(Number(e.target.value))} /></Field></div>
      </fieldset>
      <div className={PANEL}><header className="border-b border-edge px-4 py-3"><h2 className="text-sm font-semibold text-fg">{kind === 'postgres' ? '4. ' : ''}Explore exposed data</h2></header><DatasetExplorer catalog={explorerCatalog} query={previewDraft} paginate={false} /></div>
      <section className={`${PANEL} p-4`} aria-label="Dataset definition">
        {sourceText === null ? <Button aria-label="Edit dataset source" variant="ghost" disabled={Boolean(busy)} onClick={() => { try { setSourceText(serializeDatasetDefinition(buildCatalog(connection, false))); setError(''); } catch (err) { setError(err instanceof Error ? err.message : 'Could not show source.'); } }}>Edit source markup</Button> : <div className="space-y-3"><Field name="Dataset source markup"><textarea aria-label="Dataset source" spellCheck={false} className={`${control} min-h-64 resize-y text-xs leading-5`} value={sourceText} onChange={e => setSourceText(e.target.value)} /></Field><p className="text-xs text-muted">Apply markup to update the visual editor. Passwords are represented by secret references.</p><div className="flex gap-2"><Button aria-label="Apply dataset source" onClick={() => { try { const definition = parseDatasetDefinition(sourceText); if (id && definition.defaultSchema !== defaultSchema) throw new Error('The default schema of an existing dataset cannot change.'); loadDefinition(definition, undefined, true); setSourceText(null); setError(''); } catch (err) { setError(err instanceof Error ? err.message : 'Invalid dataset source.'); } }}>Apply source</Button><Button aria-label="Cancel dataset source" variant="ghost" onClick={() => setSourceText(null)}>Cancel</Button></div></div>}
      </section>
      <div className="flex items-center gap-4"><Button aria-label="Save dataset" disabled={Boolean(busy) || sourceText !== null} onClick={() => void run('save', async () => {
        const configured = kind === 'postgres' ? await ensureConnection() : connection;
        const dataset = serializeDatasetDefinition(buildCatalog(configured));
        const data = await request<{ id: string }>(id ? `/api/my/artifacts/${encodeURIComponent(id)}` : '/api/my/artifacts', { dataset, title, ...(id ? { expectedVersion: version } : { visibility: session?.user ? 'private' : 'unlisted' }) }, id ? 'PUT' : 'POST');
        router.push(`/a/${data.id}`);
      })}>{busy === 'save' ? 'Saving…' : id ? 'Save changes' : 'Create dataset'}</Button>{busy && <span role="status" className="text-sm text-muted">Working…</span>}</div>
    </>}
  </main>;
}
