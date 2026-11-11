/* @jsxImportSource solid-js */
import { creationDestination } from '../lib/creation-destination';
import { runtimeId } from '@artifactbin/utils/runtime-id';
import { AssetWorkspace, type AssetSection } from '../datasets/AssetWorkspace';
import WorkspaceShell from '../components/WorkspaceShell';
import StepHeader from "../datasets/StepHeader";
import { DocumentSharing } from '../document/DocumentSharing';
import { DatasetImport } from '../datasets/DatasetImport';
import { LiveDatasetForm, type ListedConnector } from '../datasets/LiveDatasetForm';
import { DatasetPolicies } from "../datasets/DatasetPolicies";
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { Navigate, useParams } from "@solidjs/router";
import { ChevronDown, ChevronRight, Plus, Play, Code2 } from "lucide-solid";
import { Disclosure } from "../ui/Disclosure";
import { Button } from "../ui/Button";
import { Field, Input, Textarea } from "../ui/Field";
import { Panel } from "../ui/Panel";
import { Select } from "../ui/Select";
import { StatusMessage } from "../ui/StatusMessage";
import { Tabs } from "../ui/Tabs";
import { CatalogRows, DatasetExplorer, type CatalogPreview, type CatalogQuery } from "../datasets/DatasetCatalogView";
import { parseDatasetDefinition, serializeDatasetDefinition } from "@/lib/datasets/definition";
import type { CatalogInput, DatasetCatalog } from "@/lib/datasets";
import type { DatasetColumn, Row } from "@/lib/dataflow";
import { useSession } from '../lib/session';
import { apiRequest } from '../lib/api';
/** A SQL model table over the stored tables, saved as `sql`. */
type ModelDraft = {
  cell: { id: string; name: string; sql: string };
  schema: string;
  columns: DatasetColumn[];
  selected: string[];
  stale: boolean;
  collapsed: boolean;
  preview?: CatalogPreview;
};
type StoredDraft = {
  key: string;
  schema: string;
  name: string;
  rows: string;
  columns?: CatalogInput["tables"][number]["columns"];
  retained: boolean;
};
const sourceKey = (table: {
  schema: string;
  name: string;
}) => JSON.stringify([table.schema, table.name]);
const namesToColumns = (names: string[] = []): DatasetColumn[] => names.map(name => ({
  name,
  type: "string"
}));
/** Visual authoring and source share one definition boundary. */
export function DatasetEditorPage({
  artifactId,
  onSaved,
  initialSource
}: {
  artifactId?: string;
  onSaved?: () => Promise<unknown>;
  /** The new-dataset screen's choice (datasets/NewDataset): which stored input opens first. */
  initialSource?: "csv" | "json";
} = {}) {
  const params = useParams<{
    id: string;
  }>();
  const id = artifactId ?? params.id;
  const {
    session
  } = useSession();
  const [section, setSection] = createSignal<AssetSection>("source");
  const originalDefinition = {
    current: null as string | null
  };
  const [title, setTitle] = createSignal("");
  const [storedInput, setStoredInput] = createSignal<"csv" | "sheet" | "json">(id ? "json" : initialSource ?? "csv");
  // A live dataset's editor is its connection's form (datasets/LiveDatasetForm): it has no catalog to edit.
  const [liveConnector, setLiveConnector] = createSignal<ListedConnector | null>(null);
  const [models, setModels] = createSignal<ModelDraft[]>([]);
  const [stored, setStored] = createSignal<StoredDraft[]>([]);
  const [defaultSchema, setDefaultSchema] = createSignal("");
  const [version, setVersion] = createSignal<number>();
  const [state, setState] = createSignal<string>();
  const [loading, setLoading] = createSignal(Boolean(id));
  const [loadFailed, setLoadFailed] = createSignal(false);
  const [busy, setBusy] = createSignal("");
  const [error, setError] = createSignal("");
  const [sourceText, setSourceText] = createSignal<string | null>(null);
  const loadDefinition = (input: CatalogInput, metadata?: DatasetCatalog) => {
    setDefaultSchema(input.defaultSchema ?? "public");
    setModels(input.tables.filter(t => t.sql !== undefined).map(t => ({
      cell: {
        id: runtimeId(),
        name: t.name,
        sql: t.sql!
      },
      schema: t.schema,
      columns: metadata?.tables.find(d => d.schema === t.schema && d.name === t.name)?.columns ?? namesToColumns(t.columns?.map(c => typeof c === 'string' ? c : c.name)),
      selected: t.columns?.map(c => typeof c === 'string' ? c : c.name) ?? metadata?.tables.find(d => d.schema === t.schema && d.name === t.name)?.columns.map(c => c.name) ?? [],
      stale: false,
      collapsed: false
    })));
    setStored(input.tables.filter(t => t.sql === undefined).map(t => ({
      key: runtimeId(),
      schema: t.schema,
      name: t.name,
      rows: t.rows ? JSON.stringify(t.rows, null, 2) : "",
      columns: t.columns,
      retained: t.rows === undefined
    })));
  };
  createEffect(() => {
    if (!id) return;
    let alive = true;
    void apiRequest<{
      title: string;
      version: number;
      state: string;
      meta: {
        catalog?: DatasetCatalog;
        connection?: { connector: string };
      };
      source?: string;
    }>(`/api/my/artifacts/${encodeURIComponent(id)}`).then(data => {
      if (!alive) return;
      const catalog = data.meta.catalog;
      const connection = data.meta.connection;
      if (connection) return apiRequest<{ connectors: ListedConnector[] }>('/api/connections').then(list => {
        const found = list.connectors.find(c => c.id === connection.connector);
        if (!found) throw new Error("This live dataset's connector is not available here.");
        if (alive) setLiveConnector(found);
      });
      if (!catalog) throw new Error("This artifact does not have a dataset catalog.");
      setTitle(data.title ?? "");
      setVersion(data.version);
      setState(data.state);
      loadDefinition({
        kind: "stored",
        defaultSchema: catalog.defaultSchema,
        tables: catalog.tables.map(({ schema, name, columns, sql }) => ({ schema, name, columns, ...(sql !== undefined ? { sql } : {}) }))
      }, catalog);
    }).catch(err => {
      if (alive) {
        setError(err.message);
        setLoadFailed(true);
      }
    }).finally(() => {
      if (alive) setLoading(false);
    });
    onCleanup(() => {
      alive = false;
    });
  });
  const run = async (operation: string, action: () => Promise<void>) => {
    setBusy(operation);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the server.");
    } finally {
      setBusy("");
    }
  };
  const invalidate = (items: ModelDraft[], from: number) => items.map((item, index) => index >= from ? {
    ...item,
    stale: true,
    preview: undefined
  } : item);
  const updateModel = (index: number, patch: Partial<ModelDraft["cell"]>) => setModels(items => invalidate(items.map((item, i) => i === index ? {
    ...item,
    cell: {
      ...item.cell,
      ...patch
    }
  } : item), index));
  const addModel = (after = models().length - 1) => setModels(items => {
    const next = invalidate(items, after + 1);
    let suffix = 1;
    while (items.some(item => item.cell.name === `query_${suffix}`)) suffix++;
    next.splice(after + 1, 0, {
      cell: {
        id: runtimeId(),
        name: `query_${suffix}`,
        sql: ""
      },
      schema: defaultSchema() || "public",
      columns: [],
      selected: [],
      stale: true,
      collapsed: false
    });
    return next;
  });
  const buildCatalog = (validate = true): CatalogInput => {
    const tables: CatalogInput["tables"] = stored().map(s => {
      if (!s.rows.trim() && s.retained) return {
        schema: s.schema,
        name: s.name,
        ...(s.columns !== undefined ? { columns: s.columns } : {})
      };
      let rows: unknown;
      try {
        rows = JSON.parse(s.rows);
      } catch {
        throw new Error(`Enter a JSON array of rows for ${s.name || "the stored table"}.`);
      }
      if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("Stored rows must be a JSON array of objects.");
      return {
        schema: s.schema,
        name: s.name,
        ...(s.columns !== undefined ? { columns: s.columns } : {}),
        rows: rows as Row[]
      };
    });
    for (const model of models()) {
      if (validate && model.stale) throw new Error(`Run ${model.cell.name || "the model"} again before saving or querying its exposed output.`);
      tables.push({
        schema: model.schema,
        name: model.cell.name,
        sql: model.cell.sql
      });
    }
    // Nobody has to open Advanced to make a dataset: an unchosen default
    // schema is the first table's, exactly what the select shows as automatic.
    const schema = defaultSchema() || tables[0]?.schema || "public";
    if (validate) {
      if (!tables.length) throw new Error("Expose at least one table or model output.");
      if (tables.some(t => !t.schema.trim() || !t.name.trim())) throw new Error("Every table needs a schema and name.");
      if (new Set(tables.map(sourceKey)).size !== tables.length) throw new Error("Table names must be unique within a schema.");
      if (!tables.some(t => t.schema === schema)) throw new Error("Choose a default schema containing an exposed table.");
    }
    return {
      kind: "stored",
      defaultSchema: schema,
      tables
    };
  };
  const runCell = (index: number) => {
    const model = models()[index];
    if (busy() || sourceText() !== null || !model?.cell.name.trim() || !model.cell.sql.trim()) return;
    void run(`cell-${model.cell.id}`, async () => {
      const preview = await apiRequest<CatalogPreview>("/api/my/datasets/preview", 'POST', {
        dataset: buildCatalog(false),
        sql: model.cell.sql,
        ...(id ? {
          datasetId: id
        } : {})
      });
      setModels(items => items.map(item => item.cell.id === model.cell.id ? {
        ...item,
        preview,
        columns: preview.columns,
        selected: !item.selected.length ? preview.columns.map(c => c.name) : item.selected.filter(name => preview.columns.some(c => c.name === name)),
        stale: false
      } : item));
    });
  };
  // Annotated, or the literal's element type collapses to the JSON shape and
  // the model entries' columns become invisible to the whitelist listing.
  const exposedTables = createMemo<{
    schema: string;
    name: string;
    columns?: string[];
  }[]>(() => [...stored().filter(s => s.schema && s.name).map(s => ({
    schema: s.schema,
    name: s.name
  })), ...models().filter(m => !m.stale).map(m => ({
    schema: m.schema,
    name: m.cell.name,
    columns: m.selected
  }))]);

  // Requery for exposed table changes; model presentation and hidden drafts leave this catalog stable.
  // A final preview changes only when its exposed catalog changes.
  const explorerKey = createMemo(() => JSON.stringify({
    kind: "stored", defaultSchema: defaultSchema() || exposedTables()[0]?.schema || "public",
    refreshSeconds: 0, tables: exposedTables(),
  }));
  const explorerCatalog = createMemo(() => JSON.parse(explorerKey()) as {
    kind: DatasetCatalog['kind']; defaultSchema: string; refreshSeconds: number;
    tables: Array<{ schema: string; name: string; columns?: string[] }>;
  });
  // Use the latest draft at execution time; typing source/cell SQL does not itself execute final SQL.
  const queryDraft = {
    current: null! as (sql: string) => Promise<CatalogPreview>
  };
  queryDraft.current = async sql => apiRequest<CatalogPreview>("/api/my/datasets/preview", 'POST', {
    dataset: buildCatalog(),
    sql,
    ...(id ? {
      datasetId: id
    } : {})
  });
  const previewDraft: CatalogQuery = sql => queryDraft.current(sql);
  const selectedSchemas = createMemo(() => [...new Set(exposedTables().map(t => t.schema))]);
  createEffect(() => {
    if (!id || loading() || loadFailed() || originalDefinition.current !== null) return;
    originalDefinition.current = serializeDatasetDefinition(buildCatalog(false));
  });
  if (!id && session() && !session()?.user) return <Navigate href={`/login?callbackUrl=${encodeURIComponent(id ? `/a/${id}/edit` : "/datasets/new")}`} />;
  const [policySaveTarget, setPolicySaveTarget] = createSignal<HTMLElement>();
  const saveDataset = () => void run("save", async () => {
    const savedTitle = title().trim();
    if (!savedTitle) throw new Error("Enter a dataset title.");
    const dataset = buildCatalog();
    setTitle(savedTitle);
    const metadataOnly = Boolean(id && serializeDatasetDefinition(dataset) === originalDefinition.current);
    const data = await apiRequest<{
      id: string;
    }>(id ? `/api/my/artifacts/${encodeURIComponent(id)}` : "/api/my/artifacts", metadataOnly ? "PATCH" : id ? "PUT" : "POST", metadataOnly ? {
      title: savedTitle,
      expectedState: state()
    } : {
      dataset,
      title: savedTitle,
      ...(id ? {
        expectedVersion: version(),
        expectedState: state()
      } : {
        visibility: session()?.user ? "private" : "unlisted",
        destination: creationDestination(window.location.search),
        parent_id: new URLSearchParams(window.location.search).get('parent_id')
      })
    });
    await onSaved?.();
    // Cross the app entry after consumers have read the save response.
    // A same-task document navigation can discard its body in Chromium.
    await new Promise(resolve => setTimeout(resolve, 250));
    window.location.assign(`/a/${data.id}`);
  });
  const content =
      <AssetWorkspace workspace="Dataset" tabs={loading() || loadFailed() ? [] : ['source', 'data', ...(id ? ['actions' as const] : []), ...(id ? ['sharing' as const] : [])]} active={section()} onSelect={setSection}
        actions={id && !loading() && !loadFailed() ? <div class="flex items-center gap-3 py-1">
          <Button variant="secondary" href={`/a/${id}`} aria-label="Cancel editing">Cancel</Button>
          <span hidden={section() !== 'actions'} ref={setPolicySaveTarget} />
          <span hidden={section() === 'actions' || section() === 'sharing'}><Button aria-label="Save dataset" disabled={!title().trim() || Boolean(busy()) || sourceText() !== null} onClick={saveDataset}>{busy() === 'save' ? 'Saving…' : 'Save'}</Button></span>
        </div> : undefined}>
        {error() && <p role="alert" aria-label="Dataset error" class="rounded-panel border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
            {error()}
          </p>}
        {loading() ? <StatusMessage kind="loading">Loading dataset…</StatusMessage> : loadFailed() ? <p class="text-sm text-muted">
            The dataset could not be opened for editing.
          </p> : <>
            <div hidden={section() !== "source"} class="mx-auto max-w-4xl space-y-6">
              <fieldset disabled={Boolean(busy()) || sourceText() !== null} class="min-w-0 space-y-6">
                <Field label="Dataset title (required)">
                  <Input required aria-label="Dataset title" value={title()} onInput={e => setTitle(e.target.value)} placeholder="Weekly sales" />
                </Field>
                <Panel label="Raw data" padding="none" class="overflow-hidden">
                  <StepHeader n={1} title="Raw data">
                    Import CSV or Google Sheets, or paste JSON rows.
                  </StepHeader>
                  <Tabs label="Raw data source" class="overflow-x-auto px-4 sm:gap-5 sm:px-5" value={storedInput()}
                    items={([["csv", "CSV"], ["sheet", "Google Sheets"], ["json", "JSON"]] as const).map(([value, label]) => ({ value, label }))}
                    onChange={key => setStoredInput(key as "csv" | "sheet" | "json")} />
                  {/* Keep source controls at a stable height; added tables scroll below them. */}
                  <div class="h-[22rem] overflow-y-auto p-4 sm:p-5">
                    <section aria-label="Stored tables editor" class="space-y-4">
                        {storedInput() !== "json" && <DatasetImport source={storedInput() === "sheet" ? "sheet" : "csv"} disabled={Boolean(busy())} onBusyChange={value => setBusy(value ? "import" : "")} onImported={(rows, suggestedName) => {
                          const schema = defaultSchema() || "public";
                          const base = suggestedName.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'table';
                          const stem = /^[a-z_]/.test(base) ? base : `table_${base}`;
                          const names = new Set([...stored().filter(table => table.schema === schema).map(table => table.name), ...models().filter(model => model.schema === schema).map(model => model.cell.name)]);
                          let name = stem;
                          for (let suffix = 2; names.has(name); suffix++) name = `${stem}_${suffix}`;
                          setStored(items => [...items, { key: runtimeId(), schema, name, rows: JSON.stringify(rows, null, 2), retained: false }]);
                        }} />}
                        {storedInput() === "json" && <div class="space-y-3">
                          <p class="text-xs text-muted">Add a table and paste a JSON array of objects, for example [{"{"}&quot;id&quot;: 1{"}"}].</p>
                          <Button aria-label="Add JSON table" variant="secondary" onClick={() => setStored(items => [...items, {
                            key: runtimeId(), schema: defaultSchema() || "public", name: "", rows: "", retained: false
                          }])}>Add JSON table</Button>
                        </div>}
                        {!!stored().length && <p class="text-xs font-medium text-fg">Tables in this dataset · {stored().length}</p>}
                    {stored().map((table, index) => <div class="space-y-3 border-t border-edge pt-4">
                        <div class="grid gap-3 sm:grid-cols-2">
                          <Field label="Schema">
                            <Input aria-label={`Stored schema ${index + 1}`} disabled={table.retained} value={table.schema} onInput={e => setStored(items => items.map(s => s.key === table.key ? {
                          ...s,
                          schema: e.target.value
                        } : s))} />
                          </Field>
                          <Field label="Table name">
                            <Input aria-label={`Stored table name ${index + 1}`} disabled={table.retained} value={table.name} onInput={e => setStored(items => items.map(s => s.key === table.key ? {
                          ...s,
                          name: e.target.value
                        } : s))} />
                          </Field>
                        </div>
                        <Field label={table.retained ? "Replace rows (optional)" : "Rows"}>
                          <Textarea size="sm" rows={8} aria-label={`Stored rows ${index + 1}`} spellcheck={false} value={table.rows} placeholder='[{"id": 1}]' onInput={e => setStored(items => items.map(s => s.key === table.key ? {
                        ...s,
                        rows: e.target.value
                      } : s))} />
                        </Field>
                        <Button aria-label={`Remove stored table ${index + 1}`} variant="secondary" onClick={() => setStored(items => items.filter(s => s.key !== table.key))}>
                          Remove table
                        </Button>
                      </div>)}
                      </section>
                  </div>
                </Panel>
                <Panel label="Data models notebook" padding="none" class="overflow-hidden">
                  <StepHeader n={2} title="Data models">
                    Save SQL queries over your tables as named model tables.
                  </StepHeader>
                  <div class="space-y-4 p-3 sm:p-4">
                    {!models().length && <div class="rounded-panel border border-dashed border-edge p-5 text-center">
                        <Code2 size={20} class="mx-auto mb-2 text-faint" />
                        <p class="text-sm text-muted">
                          Start with a query, build on it in the next cell.
                        </p>
                        <p class="mt-1 text-xs text-faint">
                          Optional — you can expose raw tables directly.
                        </p>
                      </div>}
                    {models().map((model, index) => <article aria-label={`Notebook cell ${index + 1}`} class="min-w-0 overflow-hidden rounded-panel border border-edge bg-bg/30">
                        <header class="flex flex-wrap items-center gap-2 border-b border-edge bg-raised/30 p-2.5">
                          <Button variant="secondary" size="sm" icon aria-label={`Collapse cell ${index + 1}`} aria-expanded={!model.collapsed} onClick={() => setModels(items => items.map(m => m.cell.id === model.cell.id ? {
                      ...m,
                      collapsed: !m.collapsed
                    } : m))}>
                            {model.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                          </Button>
                          <span class="font-mono text-xs text-faint">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <Input size="sm" aria-label={`Cell name ${index + 1}`} class="min-w-24 max-w-64 flex-1" placeholder="model_name" value={model.cell.name} onInput={e => updateModel(index, {
                      name: e.target.value
                    })} />
                          <Button aria-label={`Run cell ${index + 1}`} aria-keyshortcuts="Meta+Enter Control+Enter" variant="secondary" size="sm" disabled={!model.cell.name.trim() || !model.cell.sql.trim()} onClick={() => runCell(index)}>
                            <Play size={12} />
                            Run
                          </Button>
                        </header>
                        {!model.collapsed && <div class="space-y-3 p-3">
                            <Field label="Model schema">
                                <Input size="sm" aria-label={`Model schema ${index + 1}`} value={model.schema} onInput={e => setModels(items => items.map(m => m.cell.id === model.cell.id ? {
                        ...m,
                        schema: e.target.value
                      } : m))} />
                              </Field>
                            <Textarea size="sm" rows={6} aria-label={`Cell SQL ${index + 1}`} spellcheck={false} onKeyDown={event => {
                      if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.repeat || event.isComposing || event.keyCode === 229 || event.currentTarget.matches(":disabled") || busy() || sourceText() !== null) return;
                      event.preventDefault();
                      runCell(index);
                    }} class="resize-y leading-6" placeholder={index ? `SELECT * FROM ${models()[index - 1].cell.name || "previous_cell"}` : "SELECT * FROM public.orders"} value={model.cell.sql} onInput={e => updateModel(index, {
                      sql: e.target.value
                    })} />
                            <p class="text-2xs text-faint">
                              Run this cell with{" "}
                              <kbd class="font-mono">⌘ Enter</kbd> or{" "}
                              <kbd class="font-mono">Ctrl Enter</kbd>.
                            </p>
                            {model.preview ? <CatalogRows result={model.preview} label={`Cell preview ${index + 1}`} /> : <p class="text-xs text-faint">
                                {model.stale ? "Run this cell to inspect its current output columns." : `${model.columns.length} saved output columns · run to preview rows`}
                              </p>}
                            <div class="flex flex-wrap justify-between gap-2">
                              <Button aria-label={`Insert cell after ${index + 1}`} variant="secondary" size="sm" onClick={() => addModel(index)}>
                                <Plus size={12} />
                                Insert cell below
                              </Button>
                              <Button aria-label={`Remove cell ${index + 1}`} variant="secondary" size="sm" onClick={() => setModels(items => invalidate(items.filter(m => m.cell.id !== model.cell.id), index))}>
                                Remove
                              </Button>
                            </div>
                          </div>}
                      </article>)}
                    <Button aria-label="Add notebook cell" variant="secondary" onClick={() => addModel()}>
                      <Plus size={14} />
                      Add SQL cell
                    </Button>
                  </div>
                </Panel>
                {/* A stored table is exposed whole, and a model once its cell has run: the step shows what a
                 * reader of the dataset will get. */}
                <Panel label="Exposed tables" padding="none" class="overflow-hidden">
                    <StepHeader n={3} title="Whitelist">
                      Tables are exposed whole, and a model is exposed once its cell has run.
                    </StepHeader>
                    <div class="p-4 sm:p-5">
                      {exposedTables().length ? <ul class="grid gap-2 sm:grid-cols-2">
                          {exposedTables().map(table => <li class="flex items-center justify-between gap-3 rounded-control border border-edge bg-raised/40 px-3 py-2 text-xs">
                              <span class="truncate font-mono text-fg">
                                {table.schema}.{table.name}
                              </span>
                              <span class="shrink-0 text-muted">
                                {table.columns?.length ? `${table.columns.length} columns` : "all columns"}
                              </span>
                            </li>)}
                        </ul> : <p class="text-xs text-muted">
                          Name a table in step 1, or run a model in step 2, and it appears here.
                        </p>}
                    </div>
                  </Panel>
              </fieldset>
            </div>
            <div hidden={section() !== "data"}><Panel padding="none" class="overflow-hidden">
              <header class="border-b border-edge px-4 py-3">
                <h2 class="text-sm font-semibold text-fg">
                  Explore exposed data
                </h2>
              </header>
              <DatasetExplorer catalog={explorerCatalog()} query={previewDraft} paginate={false} />
            </Panel></div>
            <Show when={id && section() === 'sharing'}>
              <Panel class="mx-auto max-w-2xl space-y-4">
                <DocumentSharing id={id!} title={title()} owner={false} editable variant="embedded" format="dataset" onDataActions={() => setSection('actions')} />
                <p class="text-xs text-muted">Sharing changes save immediately.</p>
              </Panel>
            </Show>
            {id && <div hidden={section() !== "actions"}>
                <DatasetPolicies artifactId={id} expanded saveTarget={policySaveTarget()} />
              </div>}
            <div hidden={section() !== "source"} class="mx-auto mt-6 max-w-4xl space-y-6">
              <Panel padding="none" class="overflow-hidden"><Disclosure inset summary={<>
                  <span class="text-sm font-semibold text-fg">Advanced</span>
                  <span class="text-xs font-normal text-muted">default schema · source JSON</span>
                </>}>
                <div class="space-y-5 border-t border-edge p-4 sm:p-5">
                  <fieldset disabled={Boolean(busy()) || sourceText() !== null} class="grid gap-4 sm:grid-cols-2">
                  <Field label="Default schema" hint="Assumed when a table is named without a schema, in model SQL and in agent edits. Fixed once the dataset is created.">
                    <Select ariaLabel="Default schema" disabled={Boolean(id)} value={defaultSchema()} onChange={setDefaultSchema}
                      options={[{ value: "", label: `Automatic (${selectedSchemas()[0] ?? "public"})` }, ...[...new Set([...selectedSchemas(), ...(defaultSchema() ? [defaultSchema()] : [])])].map(schema => ({ value: schema, label: schema }))]} />
                  </Field>
                  </fieldset>
              <section class="space-y-3" aria-label="Dataset definition">
                {sourceText() === null ? <Button aria-label="Edit dataset source" variant="secondary" disabled={Boolean(busy())} onClick={() => {
                  try {
                    setSourceText(serializeDatasetDefinition(buildCatalog(false)));
                    setError("");
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not show source.");
                  }
                }}>
                    Edit source JSON
                  </Button> : <div class="space-y-3">
                    <Field label="Dataset source JSON">
                      <Textarea size="sm" rows={12} aria-label="Dataset source" spellcheck={false} class="resize-y" value={sourceText() ?? ""} onInput={e => setSourceText(e.target.value)} />
                    </Field>
                    <p class="text-xs text-muted">
                      The definition as JSON: "kind", "defaultSchema" and "tables", each with "schema", "name" and its "columns", "rows" or "sql". Apply it to update the visual editor.
                    </p>
                    <div class="flex gap-2">
                      <Button aria-label="Apply dataset source" onClick={() => {
                      try {
                        const definition = parseDatasetDefinition(sourceText()!);
                        if (id && definition.defaultSchema !== defaultSchema()) throw new Error("The default schema of an existing dataset cannot change.");
                        loadDefinition(definition);
                        setSourceText(null);
                        setError("");
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Invalid dataset source.");
                      }
                    }}>
                        Apply source
                      </Button>
                      <Button aria-label="Cancel dataset source" variant="secondary" onClick={() => setSourceText(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>}
              </section>
                </div>
              </Disclosure></Panel>
              {!id && <div class="flex items-center gap-4">
                <Button aria-label="Save dataset" disabled={!title().trim() || Boolean(busy()) || sourceText() !== null} onClick={saveDataset}>
                  {busy() === "save" ? "Saving…" : "Create dataset"}
                </Button>
                {busy() && <StatusMessage kind="loading">
                    Working…
                  </StatusMessage>}
              </div>}
            </div>
          </>}
      </AssetWorkspace>;
  // Direct dataset edit URLs need the same layout and styles as /datasets/new.
  return id ? <WorkspaceShell><Show when={liveConnector()} fallback={content}>{connector => <div class="px-4 py-8"><LiveDatasetForm connector={connector()} datasetId={id} /></div>}</Show></WorkspaceShell> : content;
}
