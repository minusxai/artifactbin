import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useParams } from 'react-router';
import { Button, Input, PANEL } from '@/components/ui';
import { CatalogRows, type CatalogPreview } from '@/components/DatasetCatalogView';
import type { CatalogInput, ConnectionSummary, DatasetCatalog, DiscoveredTable, PostgresConfig } from '@/lib/datasets/types';
import type { Row } from '@/lib/story/dataflow';
import { useRouter } from '@/lib/navigation';
import { useSession } from '@/web/session';

type InputTable = CatalogInput['tables'][number];
type SourceDraft = { discovery: DiscoveredTable; included: boolean; schema: string; name: string; columns: string[] };
type ModelDraft = { key: number; schema: string; name: string; sql: string; preview?: CatalogPreview };
type StoredDraft = { key: number; schema: string; name: string; rows: string; retained: boolean };
const initialConnection = (): PostgresConfig & { name: string } => ({ name: '', host: '', port: 5432, database: '', username: '', password: '', ssl: true });
const control = 'w-full rounded border border-edge bg-surface px-3 py-2 font-mono text-sm text-fg focus:border-accent focus:outline-none';
function Field({ name, children }: { name: string; children: ReactNode }) { return <label className="grid gap-1.5 text-xs text-muted">{name}{children}</label>; }
async function request<T>(url: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(url, body === undefined ? { credentials: 'same-origin' } : { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.details?.[0] ?? data.error ?? 'The request failed.');
  return data as T;
}
const sourceKey = (table: { schema: string; name: string }) => JSON.stringify([table.schema, table.name]);

/** Owns draft state and serialization; only connection creation receives credentials. */
export function DatasetEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { session } = useSession();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<DatasetCatalog['kind']>('stored');
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [connectionId, setConnectionId] = useState('');
  const [connection, setConnection] = useState(initialConnection);
  const [newConnection, setNewConnection] = useState(false);
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

  useEffect(() => {
    let alive = true;
    void request<{ connections: ConnectionSummary[] }>('/api/my/connections').then(data => { if (alive) setConnections(data.connections); }).catch(err => { if (alive) setError(err.message); });
    if (id) void request<{ title: string; version: number; meta: { catalog?: DatasetCatalog } }>(`/api/my/artifacts/${encodeURIComponent(id)}`).then(data => {
      if (!alive) return;
      const catalog = data.meta.catalog;
      if (!catalog) throw new Error('This artifact does not have a dataset catalog.');
      setTitle(data.title ?? ''); setVersion(data.version); setKind(catalog.kind); setConnectionId(catalog.connectionId ?? '');
      setDefaultSchema(catalog.defaultSchema); setRefreshSeconds(catalog.refreshSeconds);
      setSources(catalog.tables.filter(t => t.source).map(t => ({ discovery: { schema: t.source!.schema, name: t.source!.table, columns: t.columns }, included: true, schema: t.schema, name: t.name, columns: t.columns.map(c => c.name) })));
      setModels(catalog.tables.filter(t => t.sql !== undefined).map((t, key) => ({ key, schema: t.schema, name: t.name, sql: t.sql! })));
      setStored(catalog.tables.filter(t => !t.source && t.sql === undefined).map((t, key) => ({ key, schema: t.schema, name: t.name, rows: '', retained: true })));
    }).catch(err => { if (alive) { setError(err.message); setLoadFailed(true); } }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  const run = async (operation: string, action: () => Promise<void>) => {
    setBusy(operation); setError(''); setNotice('');
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : 'Could not reach the server.'); } finally { setBusy(''); }
  };
  const updateSource = (index: number, patch: Partial<SourceDraft>) => setSources(items => items.map((item, i) => i === index ? { ...item, ...patch } : item));
  const updateModel = (key: number, patch: Partial<ModelDraft>) => setModels(items => items.map(item => item.key === key ? { ...item, ...patch, ...(patch.sql !== undefined ? { preview: undefined } : {}) } : item));
  const updateStored = (key: number, patch: Partial<StoredDraft>) => setStored(items => items.map(item => item.key === key ? { ...item, ...patch } : item));

  const buildCatalog = (): CatalogInput => {
    const tables: InputTable[] = kind === 'postgres' ? sources.filter(s => s.included).map(s => {
      if (!s.columns.length) throw new Error(`Choose at least one column for ${s.discovery.schema}.${s.discovery.name}.`);
      return { schema: s.schema, name: s.name, source: { schema: s.discovery.schema, table: s.discovery.name }, columns: s.columns };
    }) : stored.map(s => {
      if (!s.rows.trim() && s.retained) return { schema: s.schema, name: s.name };
      let rows: unknown;
      try { rows = JSON.parse(s.rows); } catch { throw new Error(`Enter a JSON array of rows for ${s.name || 'the stored table'}.`); }
      if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Stored rows must be a JSON array of objects.');
      return { schema: s.schema, name: s.name, rows: rows as Row[] };
    });
    tables.push(...models.map(({ schema, name, sql }) => ({ schema, name, sql })));
    if (!tables.length) throw new Error('Add at least one table or SQL model.');
    if (tables.some(t => !t.schema.trim() || !t.name.trim())) throw new Error('Give each table a schema and name.');
    if (new Set(tables.map(sourceKey)).size !== tables.length) throw new Error('Each table must have a unique schema and name.');
    if (!defaultSchema || !tables.some(t => t.schema === defaultSchema)) throw new Error('Choose a default schema from the included tables.');
    if (!Number.isInteger(refreshSeconds) || refreshSeconds < 0) throw new Error('Refresh interval must be a whole number of seconds, 0 or greater.');
    if (kind === 'postgres' && !connectionId) throw new Error('Choose a PostgreSQL connection.');
    return { kind, ...(kind === 'postgres' ? { connectionId } : {}), defaultSchema, refreshSeconds, tables };
  };
  const discover = () => run('discover', async () => {
    const data = await request<{ tables: DiscoveredTable[] }>(`/api/my/connections/${encodeURIComponent(connectionId)}/test`, {});
    setSources(previous => {
      const found = data.tables.map(discovery => {
        const existing = previous.find(s => sourceKey(s.discovery) === sourceKey(discovery));
        return existing ? { ...existing, discovery } : { discovery, included: false, schema: discovery.schema, name: discovery.name, columns: [] };
      });
      // Keep prior exposure visible if a source disappeared, so the server can
      // explain the invalid source without silently removing it from a save.
      return [...found, ...previous.filter(s => !found.some(f => sourceKey(f.discovery) === sourceKey(s.discovery)))];
    });
    setNotice(`Connection succeeded. Found ${data.tables.length} tables. Choose the columns to expose.`);
  });
  const save = () => run('save', async () => {
    const dataset = buildCatalog();
    const data = await request<{ id: string }>(id ? `/api/my/artifacts/${encodeURIComponent(id)}` : '/api/my/artifacts', { title, dataset, ...(id ? { expectedVersion: version } : {visibility:session?.user?'private':'unlisted'}) }, id ? 'PUT' : 'POST');
    setConnection(initialConnection());
    router.push(`/a/${data.id}`);
  });
  const selectedSchemas = [...new Set([...(kind === 'postgres' ? sources.filter(s => s.included).map(s => s.schema) : stored.map(s => s.schema)), ...models.map(m => m.schema)])].filter(Boolean);
  const sharedConnection = Boolean(id && kind === 'postgres' && connectionId && !connections.some(c => c.id === connectionId));
  const discoverySchemas = [...new Set(sources.map(s => s.discovery.schema))];

  if (session && !session.user) return <Navigate to={`/login?callbackUrl=${encodeURIComponent(id ? `/datasets/${id}/edit` : '/datasets/new')}`} replace />;
  return <main className="mx-auto mt-8 max-w-4xl space-y-5 px-4 pb-24 sm:px-6">
    <header><a aria-label="Back to assets" href="/assets" className="font-mono text-xs text-accent">← assets</a><h1 className="mt-3 font-serif text-3xl text-fg">{id ? 'Edit dataset' : 'Create a dataset'}</h1><p className="mt-2 text-sm text-muted">Organize tables and SQL models into schemas for your documents.</p></header>
    {error && <p role="alert" aria-label="Dataset error" className="rounded border border-danger/30 bg-danger-soft p-3 text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="text-sm text-accent">{notice}</p>}
    {loading ? <p aria-label="Loading dataset" aria-busy="true" className="text-sm text-muted">Loading dataset…</p> : !loadFailed && <>
      <Field name="Dataset title"><Input aria-label="Dataset title" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Sales warehouse" /></Field>
      <div className="flex gap-2" role="group" aria-label="Dataset source">
        {(['stored', 'postgres'] as const).map(value => <Button key={value} aria-label={value === 'stored' ? 'Stored data' : 'PostgreSQL'} aria-pressed={kind === value} variant={kind === value ? 'solid' : 'ghost'} disabled={Boolean(id) || Boolean(busy)} onClick={() => setKind(value)}>{value === 'stored' ? 'Stored data' : 'PostgreSQL'}</Button>)}
      </div>
      <fieldset disabled={Boolean(busy)} className="min-w-0 space-y-5 disabled:opacity-70">
        {kind === 'postgres' && <section className={`${PANEL} space-y-4 p-4`} aria-label="PostgreSQL connection">
          <div className="flex flex-wrap items-end gap-3"><div className="min-w-48 flex-1"><Field name="Connection"><select aria-label="Connection" disabled={sharedConnection} className={control} value={connectionId} onChange={e => { setConnectionId(e.target.value); setSources([]); }}><option value="">Choose a connection</option>{connectionId && !connections.some(c => c.id === connectionId) && <option value={connectionId}>Current dataset connection</option>}{connections.map(c => <option key={c.id} value={c.id}>{c.name} · {c.database}</option>)}</select></Field></div>{!sharedConnection && <Button aria-label="New connection" variant="ghost" onClick={() => { setNewConnection(v => !v); setConnection(initialConnection()); }}>New connection</Button>}</div>
          {sharedConnection && <p aria-label="Shared dataset connection" className="text-sm text-muted">The dataset owner manages this connection and the exposed tables. You can edit SQL models using the selected columns below.</p>}
          {newConnection && !sharedConnection && <div className="space-y-3 border-t border-edge pt-4">
            <div className="grid gap-3 sm:grid-cols-2">{(['name', 'host', 'port', 'database', 'username', 'password'] as const).map(key => {
              const label = key === 'name' ? 'Connection name' : key[0].toUpperCase() + key.slice(1);
              return <Field key={key} name={label}><Input aria-label={label} type={key === 'password' ? 'password' : key === 'port' ? 'number' : 'text'} autoComplete="off" value={connection[key]} onChange={e => setConnection(c => ({ ...c, [key]: key === 'port' ? Number(e.target.value) : e.target.value }))} /></Field>;
            })}</div>
            <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" aria-label="Use SSL" checked={connection.ssl} onChange={e => setConnection(c => ({ ...c, ssl: e.target.checked }))} />Use SSL</label>
            <Button aria-label="Save connection" disabled={!connection.name || !connection.host || !connection.database || !connection.username} onClick={() => void run('connection', async () => {
              const data = await request<{ connection: ConnectionSummary }>('/api/my/connections', connection);
              setConnections(items => [...items, data.connection]); setConnectionId(data.connection.id); setSources([]); setConnection(initialConnection()); setNewConnection(false); setNotice('Connection saved. Test it to discover tables.');
            })}>Save connection</Button>
          </div>}
          <Button aria-label="Test and discover" variant="ghost" disabled={!connectionId || sharedConnection} onClick={() => void discover()}>Test and discover</Button>
        </section>}
        {kind === 'postgres' && sources.length > 0 && <fieldset disabled={sharedConnection} className={`${PANEL} min-w-0 space-y-4 p-4`} aria-label="Source exposure">
          <div><h2 className="font-medium text-fg">Choose what to expose</h2><p className="mt-1 text-sm text-muted">Tables and columns start excluded. Documents can query only the columns you select.</p></div>
          {discoverySchemas.map(schema => <div key={schema} className="space-y-2 border-t border-edge pt-3">
            <label className="flex items-center gap-2 font-mono text-sm text-fg"><input type="checkbox" aria-label={`Expose schema ${schema}`} checked={sources.filter(s => s.discovery.schema === schema).every(s => s.included)} onChange={e => setSources(items => items.map(s => s.discovery.schema === schema ? { ...s, included: e.target.checked } : s))} />{schema}</label>
            {sources.map((source, index) => source.discovery.schema !== schema ? null : <div key={sourceKey(source.discovery)} className="ml-3 rounded border border-edge p-3">
              <label className="flex items-center gap-2 font-mono text-xs text-fg"><input type="checkbox" aria-label={`Expose table ${schema}.${source.discovery.name}`} checked={source.included} onChange={e => updateSource(index, { included: e.target.checked })} />{source.discovery.name}<span className="text-faint">{source.discovery.columns.length} columns</span></label>
              {source.included && <div className="mt-3 space-y-3"><div className="grid gap-3 sm:grid-cols-2"><Field name="Logical schema"><Input aria-label={`Logical schema ${schema}.${source.discovery.name}`} value={source.schema} onChange={e => updateSource(index, { schema: e.target.value })} /></Field><Field name="Logical table name"><Input aria-label={`Logical table ${schema}.${source.discovery.name}`} value={source.name} onChange={e => updateSource(index, { name: e.target.value })} /></Field></div>
                <div className="flex flex-wrap gap-x-5 gap-y-2">{source.discovery.columns.map(column => <label key={column.name} className="flex items-center gap-2 font-mono text-xs text-muted"><input type="checkbox" aria-label={`Expose column ${schema}.${source.discovery.name}.${column.name}`} checked={source.columns.includes(column.name)} onChange={e => updateSource(index, { columns: e.target.checked ? [...source.columns, column.name] : source.columns.filter(c => c !== column.name) })} />{column.name}<span className="text-faint">{column.type}</span></label>)}</div>
              </div>}
            </div>)}
          </div>)}
        </fieldset>}
        {kind === 'stored' && <section className={`${PANEL} space-y-4 p-4`} aria-label="Stored tables">
          <h2 className="font-medium text-fg">Stored tables</h2>
          {stored.map((table, index) => <div key={table.key} className="space-y-3 border-t border-edge pt-3"><div className="grid gap-3 sm:grid-cols-2"><Field name="Schema"><Input aria-label={`Stored schema ${index + 1}`} value={table.schema} onChange={e => updateStored(table.key, { schema: e.target.value })} disabled={table.retained} /></Field><Field name="Table name"><Input aria-label={`Stored table name ${index + 1}`} value={table.name} onChange={e => updateStored(table.key, { name: e.target.value })} disabled={table.retained} /></Field></div><Field name={table.retained ? 'Rows (leave blank to keep stored rows)' : 'Rows as JSON'}><textarea aria-label={`Stored rows ${index + 1}`} className={`${control} min-h-28`} value={table.rows} onChange={e => updateStored(table.key, { rows: e.target.value })} placeholder='[{"id": 1}]' /></Field><Button aria-label={`Remove stored table ${index + 1}`} variant="ghost" onClick={() => setStored(items => items.filter(s => s.key !== table.key))}>Remove table</Button></div>)}
          <Button aria-label="Add stored table" variant="ghost" onClick={() => setStored(items => [...items, { key: Math.max(-1, ...items.map(i => i.key)) + 1, schema: defaultSchema || 'main', name: '', rows: '', retained: false }])}>Add stored table</Button>
        </section>}
        <section className={`${PANEL} space-y-4 p-4`} aria-label="SQL models"><div><h2 className="font-medium text-fg">SQL models</h2><p className="mt-1 text-sm text-muted">Save a query as a named table. Preview the result before saving.</p></div>
          {models.map((model, index) => <div key={model.key} className="space-y-3 border-t border-edge pt-3"><div className="grid gap-3 sm:grid-cols-2"><Field name="Schema"><Input aria-label={`Model schema ${index + 1}`} value={model.schema} onChange={e => updateModel(model.key, { schema: e.target.value })} /></Field><Field name="Model name"><Input aria-label={`Model name ${index + 1}`} value={model.name} onChange={e => updateModel(model.key, { name: e.target.value })} /></Field></div><Field name="SQL"><textarea aria-label={`Model SQL ${index + 1}`} spellCheck={false} className={`${control} min-h-36`} placeholder="SELECT …" value={model.sql} onChange={e => updateModel(model.key, { sql: e.target.value })} /></Field><div className="flex gap-2"><Button aria-label={`Preview model ${index + 1}`} variant="ghost" disabled={!model.sql.trim()} onClick={() => void run('preview', async () => {
            const preview = await request<CatalogPreview>('/api/my/datasets/preview', { dataset: buildCatalog(), sql: model.sql, ...(id ? { datasetId: id } : {}) }); updateModel(model.key, { preview });
          })}>Preview</Button><Button aria-label={`Remove model ${index + 1}`} variant="ghost" onClick={() => setModels(items => items.filter(m => m.key !== model.key))}>Remove model</Button></div>{model.preview && <CatalogRows result={model.preview} label={`Model preview ${index + 1}`} />}</div>)}
          <Button aria-label="Add SQL model" variant="ghost" onClick={() => setModels(items => [...items, { key: Math.max(-1, ...items.map(i => i.key)) + 1, schema: defaultSchema || 'main', name: '', sql: '' }])}>Add SQL model</Button>
        </section>
        <div className="grid gap-4 sm:grid-cols-2"><Field name="Default schema"><select aria-label="Default schema" disabled={Boolean(id)} className={control} value={defaultSchema} onChange={e => setDefaultSchema(e.target.value)}><option value="">Choose explicitly</option>{[...new Set([...selectedSchemas, ...(defaultSchema ? [defaultSchema] : [])])].map(schema => <option key={schema}>{schema}</option>)}</select></Field><Field name="Refresh interval (seconds, 0 = manual)"><Input aria-label="Refresh interval" type="number" min={0} step={1} value={refreshSeconds} onChange={e => setRefreshSeconds(Number(e.target.value))} /></Field></div>
      </fieldset>
      <div className="flex items-center gap-4"><Button aria-label="Save dataset" disabled={Boolean(busy)} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : id ? 'Save changes' : 'Create dataset'}</Button>{busy && <span role="status" className="text-sm text-muted">Working…</span>}</div>
    </>}
  </main>;
}
