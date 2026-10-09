/* @jsxImportSource solid-js */
import { runtimeId } from '@/lib/story-runtime/runtime-id';
import { AssetWorkspace, type AssetSection } from '../components/AssetWorkspace';
import WorkspaceShell from '../components/WorkspaceShell';
import StepHeader from "../components/StepHeader";
import { DocumentSharing } from '../document/DocumentSharing';
import { DatasetImport } from '../components/DatasetImport';
import { DatasetPolicies } from "../components/DatasetPolicies";
import { createEffect, createMemo, createSignal, onCleanup, Show, type JSX } from "solid-js";
import { Navigate, useParams } from "@solidjs/router";
import { ChevronDown, ChevronRight, Plus, Play, Code2 } from "lucide-solid";
import { Button, Input, PANEL } from "../components/ui";
import { CatalogRows, DatasetExplorer, type CatalogPreview, type CatalogQuery } from "../components/DatasetCatalogView";
import { DatasetWhitelist, type SourceDraft } from "../components/DatasetWhitelist";
import { parseDatasetDefinition, serializeDatasetDefinition } from "@/lib/datasets/definition";
import type { CatalogInput, DatasetCatalog, DatasetConnection, DiscoveredTable, NotebookCell } from "@/lib/datasets/types";
import type { DatasetColumn } from "@/lib/dataflow/dataset-shape";
import type { Row } from "@/lib/dataflow/dataflow";
import { useSession } from '../lib/session';
import { apiRequest } from '../lib/api';
type ModelDraft = {
  cell: NotebookCell;
  schema: string;
  columns: DatasetColumn[];
  selected: string[];
  stale: boolean;
  collapsed: boolean;
  legacy: boolean;
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
const initialConnection = (): DatasetConnection => ({
  host: "",
  port: 5432,
  database: "",
  username: "",
  passwordSecretId: "",
  ssl: true
});
const control = "w-full rounded border border-edge bg-surface px-3 py-2 font-mono text-sm text-fg focus:border-accent focus:outline-none";
const sourceKey = (table: {
  schema: string;
  name: string;
}) => JSON.stringify([table.schema, table.name]);
const namesToColumns = (names: string[] = []): DatasetColumn[] => names.map(name => ({
  name,
  type: "string"
}));
function Field({
  name,
  children
}: {
  name: string;
  children: JSX.Element;
}) {
  return <label class="grid min-w-0 gap-1.5 text-xs text-muted">
      {name}
      {children}
    </label>;
}
/** Visual authoring and source share one definition boundary. Passwords never enter the definition. */
export function DatasetEditorPage({
  artifactId,
  onSaved
}: {
  artifactId?: string;
  onSaved?: () => Promise<unknown>;
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
  const [kind, setKind] = createSignal<DatasetCatalog["kind"]>("stored");
  const [storedInput, setStoredInput] = createSignal<"csv" | "sheet" | "json">(id ? "json" : "csv");
  const [connection, setConnection] = createSignal(initialConnection());
  const [password, setPassword] = createSignal("");
  const [sources, setSources] = createSignal<SourceDraft[]>([]);
  const [models, setModels] = createSignal<ModelDraft[]>([]);
  const [stored, setStored] = createSignal<StoredDraft[]>([]);
  const [defaultSchema, setDefaultSchema] = createSignal("");
  const [refreshSeconds, setRefreshSeconds] = createSignal(0);
  const [version, setVersion] = createSignal<number>();
  const [state, setState] = createSignal<string>();
  const [loading, setLoading] = createSignal(Boolean(id));
  const [loadFailed, setLoadFailed] = createSignal(false);
  const [busy, setBusy] = createSignal("");
  const [error, setError] = createSignal("");
  const [connectionFeedback, setConnectionFeedback] = createSignal<{
    kind: "connecting" | "success" | "error";
    message: string;
  } | null>(null);
  const [sourceText, setSourceText] = createSignal<string | null>(null);
  const loadDefinition = (input: CatalogInput, metadata?: DatasetCatalog, preserveDraft = false) => {
    setKind(input.kind);
    setConnection(input.connection ?? initialConnection());
    setPassword("");
    setConnectionFeedback(null);
    setDefaultSchema(input.defaultSchema ?? "public");
    setRefreshSeconds(input.refreshSeconds ?? 0);
    const sameConnection = Boolean(input.connection && Object.entries(connection()).every(([key, value]) => input.connection![key as keyof DatasetConnection] === value));
    const discoveries = metadata?.notebookSources ?? (preserveDraft && sameConnection ? sources().map(s => s.discovery) : []);
    const physical = input.tables.filter(t => t.source).map(t => {
      const discovery = discoveries.find(d => d.schema === t.source!.schema && d.name === t.source!.table);
      const shape = metadata?.tables.find(d => d.schema === t.schema && d.name === t.name)?.columns ?? namesToColumns(t.columns?.map(c => typeof c === 'string' ? c : c.name));
      return {
        discovery: discovery ?? {
          schema: t.source!.schema,
          name: t.source!.table,
          columns: shape
        },
        included: true,
        schema: t.schema,
        name: t.name,
        columns: t.columns?.map(c => typeof c === 'string' ? c : c.name) ?? shape.map(c => c.name)
      };
    });
    setSources([...physical, ...discoveries.filter(d => !physical.some(s => sourceKey(s.discovery) === sourceKey(d))).map(discovery => ({
      discovery,
      included: false,
      schema: discovery.schema,
      name: discovery.name,
      columns: []
    }))]);
    const notebookCells = input.notebook?.cells ?? [];
    const notebook = notebookCells.map((cell, index) => {
      const table = input.tables.find(t => t.modelCellId === cell.id);
      const prefixUnchanged = notebookCells.slice(0, index + 1).every((candidate, i) => {
        const previous = models().filter(m => !m.legacy)[i]?.cell;
        return previous && candidate.id === previous.id && candidate.name === previous.name && candidate.sql === previous.sql;
      });
      const previous = preserveDraft && sameConnection && prefixUnchanged ? models().find(m => m.cell.id === cell.id) : undefined;
      const columns = preserveDraft ? previous?.columns ?? [] : metadata?.tables.find(t => t.modelCellId === cell.id)?.columns ?? [];
      const stale = preserveDraft ? !previous || previous.stale || Boolean(table?.columns?.some(name => !columns.some(c => c.name === name))) : !table;
      return {
        cell,
        schema: table?.schema ?? "models",
        columns,
        selected: table?.columns?.map(c => typeof c === 'string' ? c : c.name) ?? [],
        stale,
        collapsed: previous?.collapsed ?? false,
        legacy: false,
        ...(previous && !stale ? {
          preview: previous.preview
        } : {})
      };
    });
    const legacy = input.tables.filter(t => t.sql !== undefined).map(t => ({
      cell: {
        id: runtimeId(),
        name: t.name,
        sql: t.sql!
      },
      schema: t.schema,
      columns: metadata?.tables.find(d => d.schema === t.schema && d.name === t.name)?.columns ?? namesToColumns(t.columns?.map(c => typeof c === 'string' ? c : c.name)),
      selected: t.columns?.map(c => typeof c === 'string' ? c : c.name) ?? metadata?.tables.find(d => d.schema === t.schema && d.name === t.name)?.columns.map(c => c.name) ?? [],
      stale: false,
      collapsed: false,
      legacy: true
    }));
    setModels([...notebook, ...legacy]);
    setStored(input.tables.filter(t => !t.source && t.sql === undefined && !t.modelCellId).map(t => ({
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
      };
      source?: string;
    }>(`/api/my/artifacts/${encodeURIComponent(id)}`).then(data => {
      if (!alive) return;
      const catalog = data.meta.catalog;
      if (!catalog) throw new Error("This artifact does not have a dataset catalog.");
      if (catalog.kind === "postgres") setSection("source");
      setTitle(data.title ?? "");
      setVersion(data.version);
      setState(data.state);
      loadDefinition({
        ...catalog,
        tables: catalog.tables.map(({
          objectKey: _,
          ...table
        }) => ({
          ...table,
          columns: catalog.kind === "stored" ? table.columns : table.columns.map(c => c.name)
        }))
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
    if (operation === "discover") setConnectionFeedback({
      kind: "connecting",
      message: "Connecting to PostgreSQL…"
    });else setConnectionFeedback(value => value?.kind === "error" ? null : value);
    try {
      await action();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not reach the server.";
      if (operation === "discover") setConnectionFeedback({
        kind: "error",
        message
      });else setError(message);
    } finally {
      setBusy("");
    }
  };
  const invalidate = (items: ModelDraft[], from: number) => items.map((item, index) => index >= from ? {
    ...item,
    stale: true,
    preview: undefined
  } : item);
  const updateModel = (index: number, patch: Partial<NotebookCell>) => setModels(items => invalidate(items.map((item, i) => i === index ? {
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
      schema: kind() === "postgres" ? "models" : defaultSchema() || "public",
      columns: [],
      selected: [],
      stale: true,
      collapsed: false,
      legacy: kind() === "stored"
    });
    return next;
  });
  const updateConnection = (patch: Partial<DatasetConnection>) => {
    setConnectionFeedback(null);
    setConnection(value => ({
      ...value,
      ...patch,
      passwordSecretId: ""
    }));
    setModels(items => invalidate(items, 0));
  };
  const ensureConnection = async () => {
    if (!connection().host.trim() || !connection().database.trim() || !connection().username.trim() || !Number.isInteger(connection().port) || connection().port < 1 || connection().port > 65535) throw new Error("Enter a host, port, database and username.");
    if (connection().passwordSecretId) return connection();
    if (!password()) throw new Error("Enter a password for this connection. Changing the destination requires a replacement password.");
    const {
      passwordSecretId: _,
      ...destination
    } = connection();
    const data = await apiRequest<{
      secret: {
        id: string;
      };
    }>("/api/my/secrets", 'POST', {
      value: password(),
      connection: destination,
      ...(id ? {
        datasetId: id
      } : {})
    });
    const configured = {
      ...connection(),
      passwordSecretId: data.secret.id
    };
    setConnection(configured);
    setPassword("");
    return configured;
  };
  const notebook = () => ({
    cells: models().filter(m => !m.legacy).map(m => m.cell)
  });
  const buildCatalog = (configured = connection(), validate = true): CatalogInput => {
    const tables: CatalogInput["tables"] = kind() === "postgres" ? sources().filter(s => s.included && s.columns.length).map(s => ({
      schema: s.schema,
      name: s.name,
      source: {
        schema: s.discovery.schema,
        table: s.discovery.name
      },
      columns: s.columns
    })) : stored().map(s => {
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
      if (!model.selected.length && !model.legacy) continue;
      if (validate && model.stale) throw new Error(`Run ${model.cell.name || "the model"} again before saving or querying its exposed output.`);
      if (model.legacy) tables.push({
        schema: model.schema,
        name: model.cell.name,
        sql: model.cell.sql
      });else tables.push({
        schema: model.schema,
        name: model.cell.name,
        modelCellId: model.cell.id,
        columns: model.selected
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
      if (!Number.isInteger(refreshSeconds()) || refreshSeconds() < 0) throw new Error("Refresh interval must be a whole number of seconds, or 0 for manual refresh.");
    }
    return {
      kind: kind(),
      ...(kind() === "postgres" ? {
        connection: configured,
        notebook: notebook()
      } : {}),
      defaultSchema: schema,
      refreshSeconds: refreshSeconds(),
      tables
    };
  };
  const runCell = (index: number) => {
    const model = models()[index];
    if (busy() || sourceText() !== null || !model?.cell.name.trim() || !model.cell.sql.trim()) return;
    void run(`cell-${model.cell.id}`, async () => {
      const allCells = notebook().cells;
      const cells = allCells.slice(0, allCells.findIndex(cell => cell.id === model.cell.id) + 1);
      if (new Set(cells.map(c => c.name)).size !== cells.length || cells.some(c => !c.name.trim())) throw new Error("Give every notebook cell a unique name.");
      const preview = model.legacy ? await apiRequest<CatalogPreview>("/api/my/datasets/preview", 'POST', {
        dataset: buildCatalog(connection(), false),
        sql: model.cell.sql,
        ...(id ? {
          datasetId: id
        } : {})
      }) : await apiRequest<CatalogPreview>("/api/my/datasets/notebook/preview", 'POST', {
        connection: await ensureConnection(),
        notebook: {
          cells
        },
        cellId: model.cell.id,
        ...(id ? {
          datasetId: id
        } : {})
      });
      setModels(items => items.map(item => item.cell.id === model.cell.id ? {
        ...item,
        preview,
        columns: preview.columns,
        selected: item.legacy && !item.selected.length ? preview.columns.map(c => c.name) : item.selected.filter(name => preview.columns.some(c => c.name === name)),
        stale: false
      } : item));
    });
  };
  const discover = () => void run("discover", async () => {
    const configured = await ensureConnection();
    const data = await apiRequest<{
      tables: DiscoveredTable[];
    }>("/api/my/datasets/discover", 'POST', {
      connection: configured,
      ...(id ? {
        datasetId: id
      } : {})
    });
    setSources(current => {
      const discovered = data.tables.map(discovery => {
        const previous = current.find(s => sourceKey(s.discovery) === sourceKey(discovery));
        // A disappeared selected leaf stays explicit until the editor removes it or the server validates it.
        const missing = previous?.discovery.columns.filter(column => previous.columns.includes(column.name) && !discovery.columns.some(c => c.name === column.name)) ?? [];
        return {
          discovery: {
            ...discovery,
            columns: [...discovery.columns, ...missing]
          },
          schema: previous?.schema ?? discovery.schema,
          name: previous?.name ?? discovery.name,
          included: previous?.included ?? false,
          columns: previous?.columns ?? []
        };
      });
      return [...discovered, ...current.filter(previous => previous.included && !data.tables.some(d => sourceKey(d) === sourceKey(previous.discovery)))];
    });
    setConnectionFeedback({
      kind: "success",
      message: data.tables.length ? `Connected. Found ${data.tables.length} table${data.tables.length === 1 ? "" : "s"}. Choose what to expose below.` : "Connected. No tables found for this database account."
    });
  });
  const exposures = createMemo<SourceDraft[]>(() => [...sources(), ...models().filter(m => !m.legacy).map(m => ({
    discovery: {
      schema: m.schema,
      name: m.cell.name || "Untitled cell",
      columns: m.stale ? [] : m.columns
    },
    schema: m.schema,
    name: m.cell.name,
    columns: m.selected,
    included: m.selected.length > 0,
    modelCellId: m.cell.id,
    stale: m.stale
  }))]);
  const changeExposures = (next: SourceDraft[]) => {
    setSources(next.filter(s => !s.modelCellId));
    setModels(items => items.map(item => {
      const entry = next.find(s => s.modelCellId === item.cell.id);
      return entry && !item.stale ? {
        ...item,
        selected: entry.included ? entry.columns : []
      } : item;
    }));
  };
  // Annotated, or the literal's element type collapses to the JSON shape and
  // the model entries' columns become invisible to the whitelist listing.
  const exposedTables = createMemo<{
    schema: string;
    name: string;
    columns?: string[];
  }[]>(() => [...(kind() === "postgres" ? sources().filter(s => s.included && s.columns.length).map(s => ({
    schema: s.schema,
    name: s.name,
    columns: s.columns
  })) : stored().filter(s => s.schema && s.name).map(s => ({
    schema: s.schema,
    name: s.name
  }))), ...models().filter(m => !m.stale && (m.selected.length || m.legacy)).map(m => ({
    schema: m.schema,
    name: m.cell.name,
    columns: m.selected
  }))]);

  // Requery for exposed column changes; notebook presentation and hidden drafts leave this catalog stable.
  // A final preview changes only when its exposed catalog changes.
  const explorerKey = createMemo(() => JSON.stringify({
    kind: kind(), defaultSchema: defaultSchema() || exposedTables()[0]?.schema || "public",
    refreshSeconds: refreshSeconds(), tables: exposedTables(),
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
    originalDefinition.current = serializeDatasetDefinition(buildCatalog(connection(), false));
  });
  if (!id && session() && !session()?.user) return <Navigate href={`/login?callbackUrl=${encodeURIComponent(id ? `/a/${id}/edit` : "/datasets/new")}`} />;
  const [policySaveTarget, setPolicySaveTarget] = createSignal<HTMLElement>();
  const saveDataset = () => void run("save", async () => {
    const savedTitle = title().trim();
    if (!savedTitle) throw new Error("Enter a dataset title.");
    const configured = kind() === "postgres" ? await ensureConnection() : connection();
    const dataset = serializeDatasetDefinition(buildCatalog(configured));
    setTitle(savedTitle);
    const metadataOnly = Boolean(id && dataset === originalDefinition.current);
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
        visibility: session()?.user ? "private" : "unlisted"
      })
    });
    await onSaved?.();
    // Cross the app entry after consumers have read the save response.
    // A same-task document navigation can discard its body in Chromium.
    await new Promise(resolve => setTimeout(resolve, 250));
    window.location.assign(`/a/${data.id}`);
  });
  const content =
      <AssetWorkspace workspace="Dataset" tabs={loading() || loadFailed() ? [] : ['source', 'data', ...(id && kind() === 'stored' ? ['actions' as const] : []), ...(id ? ['sharing' as const] : [])]} active={section()} onSelect={setSection}
        actions={id && !loading() && !loadFailed() ? <div class="flex items-center gap-3 py-1">
          <a href={`/a/${id}`} aria-label="Cancel editing" class="px-2 py-1 font-mono text-xs text-muted hover:text-fg">Cancel</a>
          <span hidden={section() !== 'actions'} ref={setPolicySaveTarget} />
          <span hidden={section() === 'actions' || section() === 'sharing'}><Button aria-label="Save dataset" disabled={!title().trim() || Boolean(busy()) || sourceText() !== null} onClick={saveDataset}>{busy() === 'save' ? 'Saving…' : 'Save'}</Button></span>
        </div> : undefined}>
        {error() && <p role="alert" aria-label="Dataset error" class="rounded border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
            {error()}
          </p>}
        {loading() ? <p class="text-sm text-muted">Loading dataset…</p> : loadFailed() ? <p class="text-sm text-muted">
            The dataset could not be opened for editing.
          </p> : <>
            <div hidden={section() !== "source"} class="mx-auto max-w-4xl space-y-6">
              <fieldset disabled={Boolean(busy()) || sourceText() !== null} class="min-w-0 space-y-6">
                <Field name="Dataset title (required)">
                  <Input required aria-label="Dataset title" value={title()} onInput={e => setTitle(e.target.value)} placeholder="Weekly sales" />
                </Field>
                <section aria-label="Raw data" class={`${PANEL} overflow-hidden rounded-xl`}>
                  <StepHeader n={1} title="Raw data">
                    Import CSV or Google Sheets, paste JSON rows, or connect to PostgreSQL.
                  </StepHeader>
                  <div role="tablist" aria-label="Raw data source" class="flex gap-4 overflow-x-auto border-b border-edge px-4 sm:gap-5 sm:px-5">
                    {([["csv", "CSV"], ["sheet", "Google Sheets"], ["json", "JSON"], ["postgres", "PostgreSQL"]] as const).map(([key, label]) => {
                      const selected = () => kind() === "postgres" ? key === "postgres" : key === storedInput();
                      return <button type="button" role="tab" aria-label={label} aria-selected={selected()} disabled={Boolean(id) && (key === "postgres") !== (kind() === "postgres")} onClick={() => {
                        setKind(key === "postgres" ? "postgres" : "stored");
                        if (key !== "postgres") setStoredInput(key);
                      }} class={`-mb-px shrink-0 border-b-2 px-1 py-3 text-xs font-medium disabled:cursor-default ${selected() ? "border-accent text-fg" : "border-transparent text-muted enabled:hover:text-fg disabled:opacity-50"}`}>
                        {label}
                      </button>;
                    })}
                  </div>
                  {/* Keep source controls at a stable height; added tables scroll below them. */}
                  <div class="h-[22rem] overflow-y-auto p-4 sm:p-5">
                    {kind() === "postgres" ? <section aria-label="Dataset connection" class="space-y-4">
                        <p class="text-xs text-muted">
                          Use a database account with read access. The password is stored securely and cannot be retrieved.
                        </p>
                    <div class="grid gap-4 sm:grid-cols-[1fr_7rem]">
                      <Field name="Host">
                        <Input aria-label="Host" autocomplete="off" placeholder="db.example.com" value={connection().host} onInput={e => updateConnection({
                        host: e.target.value
                      })} />
                      </Field>
                      <Field name="Port">
                        <Input aria-label="Port" type="number" min={1} max={65535} value={connection().port} onInput={e => updateConnection({
                        port: Number(e.target.value)
                      })} />
                      </Field>
                    </div>
                    <div class="grid gap-4 sm:grid-cols-2">
                      <Field name="Database">
                        <Input aria-label="Database" autocomplete="off" value={connection().database} onInput={e => updateConnection({
                        database: e.target.value
                      })} />
                      </Field>
                      <Field name="Username">
                        <Input aria-label="Username" autocomplete="off" value={connection().username} onInput={e => updateConnection({
                        username: e.target.value
                      })} />
                      </Field>
                    </div>
                    {connection().passwordSecretId ? <div class="flex items-center gap-3">
                        <span aria-label="Password status" class="text-xs text-muted">
                          Password · Configured
                        </span>
                        <Button aria-label="Replace password" variant="ghost" onClick={() => {
                      setConnectionFeedback(null);
                      setConnection(value => ({
                        ...value,
                        passwordSecretId: ""
                      }));
                      setPassword("");
                    }}>
                          Replace
                        </Button>
                      </div> : <Field name="Password">
                        <Input aria-label="Password" type="password" autocomplete="new-password" value={password()} onInput={e => {
                      setConnectionFeedback(null);
                      setPassword(e.target.value);
                    }} />
                      </Field>}
                    <div class="flex flex-wrap items-center justify-between gap-3">
                      <label class="flex items-center gap-2 text-xs text-muted">
                        <input aria-label="Use SSL" type="checkbox" class="accent-accent" checked={connection().ssl} onChange={e => updateConnection({
                        ssl: e.target.checked
                      })} />
                        Use SSL / TLS
                      </label>
                      <Button aria-label="Test and discover" variant="ghost" onClick={discover}>
                        {busy() === "discover" ? "Connecting…" : "Test and discover"}
                      </Button>
                    </div>
                    {connectionFeedback() && <p role={connectionFeedback()!.kind === "error" ? "alert" : "status"} aria-label={connectionFeedback()!.kind === "error" ? "Dataset error" : "Dataset notice"} class={`text-xs leading-5 ${connectionFeedback()!.kind === "error" ? "text-danger" : connectionFeedback()!.kind === "success" ? "text-accent" : "text-muted"}`}>
                        {connectionFeedback()!.message}
                      </p>}
                      </section> : <section aria-label="Stored tables editor" class="space-y-4">
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
                          <Button aria-label="Add JSON table" variant="ghost" onClick={() => setStored(items => [...items, {
                            key: runtimeId(), schema: defaultSchema() || "public", name: "", rows: "", retained: false
                          }])}>Add JSON table</Button>
                        </div>}
                        {!!stored().length && <p class="text-xs font-medium text-fg">Tables in this dataset · {stored().length}</p>}
                    {stored().map((table, index) => <div class="space-y-3 border-t border-edge pt-4">
                        <div class="grid gap-3 sm:grid-cols-2">
                          <Field name="Schema">
                            <Input aria-label={`Stored schema ${index + 1}`} disabled={table.retained} value={table.schema} onInput={e => setStored(items => items.map(s => s.key === table.key ? {
                          ...s,
                          schema: e.target.value
                        } : s))} />
                          </Field>
                          <Field name="Table name">
                            <Input aria-label={`Stored table name ${index + 1}`} disabled={table.retained} value={table.name} onInput={e => setStored(items => items.map(s => s.key === table.key ? {
                          ...s,
                          name: e.target.value
                        } : s))} />
                          </Field>
                        </div>
                        <Field name={table.retained ? "Replace rows (optional)" : "Rows"}>
                          <textarea aria-label={`Stored rows ${index + 1}`} class={`${control} min-h-32`} spellcheck={false} value={table.rows} placeholder='[{"id": 1}]' onInput={e => setStored(items => items.map(s => s.key === table.key ? {
                        ...s,
                        rows: e.target.value
                      } : s))} />
                        </Field>
                        <Button aria-label={`Remove stored table ${index + 1}`} variant="ghost" onClick={() => setStored(items => items.filter(s => s.key !== table.key))}>
                          Remove table
                        </Button>
                      </div>)}
                      </section>}
                  </div>
                </section>
                <section aria-label="Data models notebook" class={`${PANEL} rounded-xl overflow-hidden`}>
                  <StepHeader n={2} title="Data models">
                    {kind() === "postgres" ? "Read raw tables using schema.table, for example public.orders. Later cells can reference an earlier cell by its name. Expose only the outputs readers need." : "Save SQL queries over your JSON tables as named model tables."}
                  </StepHeader>
                  <div class="space-y-4 p-3 sm:p-4">
                    {!models().length && <div class="rounded border border-dashed border-edge p-5 text-center">
                        <Code2 size={20} class="mx-auto mb-2 text-faint" />
                        <p class="text-sm text-muted">
                          Start with a query, build on it in the next cell.
                        </p>
                        <p class="mt-1 text-xs text-faint">
                          Optional — you can expose raw tables directly.
                        </p>
                      </div>}
                    {models().map((model, index) => <article aria-label={`Notebook cell ${index + 1}`} class="min-w-0 overflow-hidden rounded border border-edge bg-bg/30">
                        <header class="flex flex-wrap items-center gap-2 border-b border-edge bg-raised/30 p-2.5">
                          <button type="button" aria-label={`Collapse cell ${index + 1}`} aria-expanded={!model.collapsed} class="rounded p-1 text-muted hover:text-fg" onClick={() => setModels(items => items.map(m => m.cell.id === model.cell.id ? {
                      ...m,
                      collapsed: !m.collapsed
                    } : m))}>
                            {model.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                          </button>
                          <span class="font-mono text-xs text-faint">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <Input aria-label={`Cell name ${index + 1}`} class="min-w-24 max-w-64 flex-1 bg-transparent text-xs" placeholder="model_name" value={model.cell.name} onInput={e => updateModel(index, {
                      name: e.target.value
                    })} />
                          {!model.legacy && <label class="ml-auto flex items-center gap-2 text-xs text-muted">
                              <input aria-label={`Expose cell ${index + 1}`} type="checkbox" class="accent-accent" disabled={model.stale || !model.columns.length} checked={!model.stale && model.selected.length === model.columns.length && model.columns.length > 0} aria-checked={!model.stale && model.selected.length > 0 && model.selected.length < model.columns.length ? "mixed" : !model.stale && model.selected.length > 0} ref={node => {
                        if (node) node.indeterminate = !model.stale && model.selected.length > 0 && model.selected.length < model.columns.length;
                      }} onChange={e => setModels(items => items.map(m => m.cell.id === model.cell.id ? {
                        ...m,
                        selected: e.target.checked ? m.columns.map(c => c.name) : []
                      } : m))} />
                              Expose
                            </label>}
                          <Button aria-label={`Run cell ${index + 1}`} aria-keyshortcuts="Meta+Enter Control+Enter" variant="ghost" disabled={!model.cell.name.trim() || !model.cell.sql.trim()} onClick={() => runCell(index)} class="inline-flex items-center gap-1.5">
                            <Play size={12} />
                            Run
                          </Button>
                        </header>
                        {!model.collapsed && <div class="space-y-3 p-3">
                            {model.legacy && <Field name="Model schema">
                                <Input aria-label={`Model schema ${index + 1}`} value={model.schema} onInput={e => setModels(items => items.map(m => m.cell.id === model.cell.id ? {
                        ...m,
                        schema: e.target.value
                      } : m))} />
                              </Field>}
                            <textarea aria-label={`Cell SQL ${index + 1}`} spellcheck={false} onKeyDown={event => {
                      if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.repeat || event.isComposing || event.keyCode === 229 || event.currentTarget.matches(":disabled") || busy() || sourceText() !== null) return;
                      event.preventDefault();
                      runCell(index);
                    }} class={`${control} min-h-36 resize-y border-transparent bg-transparent leading-6`} placeholder={index ? `SELECT * FROM ${models()[index - 1].cell.name || "previous_cell"}` : "SELECT * FROM public.orders"} value={model.cell.sql} onInput={e => updateModel(index, {
                      sql: e.target.value
                    })} />
                            <p class="text-[11px] text-faint">
                              Run this cell with{" "}
                              <kbd class="font-mono">⌘ Enter</kbd> or{" "}
                              <kbd class="font-mono">Ctrl Enter</kbd>.
                            </p>
                            {model.preview ? <CatalogRows result={model.preview} label={`Cell preview ${index + 1}`} /> : <p class="text-xs text-faint">
                                {model.stale ? "Run this cell to inspect its current output columns." : `${model.columns.length} saved output columns · run to preview rows`}
                              </p>}
                            <div class="flex flex-wrap justify-between gap-2">
                              <Button aria-label={`Insert cell after ${index + 1}`} variant="ghost" class="inline-flex items-center gap-1" onClick={() => addModel(index)}>
                                <Plus size={12} />
                                Insert cell below
                              </Button>
                              <Button aria-label={`Remove cell ${index + 1}`} variant="ghost" onClick={() => setModels(items => invalidate(items.filter(m => m.cell.id !== model.cell.id), index))}>
                                Remove
                              </Button>
                            </div>
                          </div>}
                      </article>)}
                    <Button aria-label="Add notebook cell" variant="ghost" class="inline-flex items-center gap-1.5" onClick={() => addModel()}>
                      <Plus size={14} />
                      Add SQL cell
                    </Button>
                  </div>
                </section>
                {kind() === "postgres" ? <DatasetWhitelist sources={exposures()} onChange={changeExposures} /> : (
            /* JSON tables have no picker: a pasted table is exposed
             * whole, and a model once its cell has run. The step still
             * exists so the reader sees what a reader of the dataset
             * will get, in the same place the PostgreSQL picker sits. */
            <section aria-label="Exposed tables" class={`${PANEL} overflow-hidden rounded-xl`}>
                    <StepHeader n={3} title="Whitelist">
                      JSON tables are exposed whole, and a model is exposed once its cell has run. Column-level whitelisting is for PostgreSQL sources.
                    </StepHeader>
                    <div class="p-4 sm:p-5">
                      {exposedTables().length ? <ul class="grid gap-2 sm:grid-cols-2">
                          {exposedTables().map(table => <li class="flex items-center justify-between gap-3 rounded border border-edge bg-raised/40 px-3 py-2 text-xs">
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
                  </section>)}
              </fieldset>
            </div>
            <div hidden={section() !== "data"} class={`${PANEL} rounded-xl overflow-hidden rounded-xl`}>
              <header class="border-b border-edge px-4 py-3">
                <h2 class="text-sm font-semibold text-fg">
                  Explore exposed data
                </h2>
              </header>
              <DatasetExplorer catalog={explorerCatalog()} query={previewDraft} paginate={false} />
            </div>
            <Show when={id && section() === 'sharing'}>
              <div class="mx-auto max-w-2xl space-y-4 rounded-lg border border-edge bg-surface p-5 sm:p-6">
                <DocumentSharing id={id!} title={title()} owner={false} editable variant="embedded" format="dataset" datasetKind={kind()} onDataActions={() => setSection('actions')} />
                <p class="text-xs text-muted">Sharing changes save immediately.</p>
              </div>
            </Show>
            {id && kind() === "stored" && <div hidden={section() !== "actions"}>
                <DatasetPolicies artifactId={id} expanded saveTarget={policySaveTarget()} />
              </div>}
            <div hidden={section() !== "source"} class="mx-auto mt-6 max-w-4xl space-y-6">
              <details class={`group ${PANEL} overflow-hidden rounded-xl`}>
                <summary class="flex cursor-pointer list-none items-center gap-2 px-4 py-3 sm:px-5 [&::-webkit-details-marker]:hidden">
                  <ChevronRight size={14} class="text-muted transition-transform group-open:rotate-90" />
                  <span class="text-sm font-semibold text-fg">Advanced</span>
                  <span class="text-xs text-muted">default schema · result cache · source markup</span>
                </summary>
                <div class="space-y-5 border-t border-edge p-4 sm:p-5">
                  <fieldset disabled={Boolean(busy()) || sourceText() !== null} class="grid gap-4 sm:grid-cols-2">
                  <Field name="Default schema">
                    <span class="text-[11px] leading-4 text-faint">Assumed when a table is named without a schema, in notebook SQL and in agent edits. Fixed once the dataset is created.</span>
                    <select aria-label="Default schema" disabled={Boolean(id)} class={control} value={defaultSchema()} onInput={e => setDefaultSchema(e.target.value)}>
                      <option value="" selected={defaultSchema() === ""}>Automatic ({selectedSchemas()[0] ?? "public"})</option>
                      {[...new Set([...selectedSchemas(), ...(defaultSchema() ? [defaultSchema()] : [])])].map(schema => <option selected={defaultSchema() === schema}>{schema}</option>)}
                    </select>
                  </Field>
                  <Field name="Result cache (seconds)">
                    <span class="text-[11px] leading-4 text-faint">PostgreSQL results are served from cache this long before being queried again; 0 queries the database on every read. Ignored for JSON tables.</span>
                    <Input aria-label="Refresh interval" type="number" min={0} step={1} value={refreshSeconds()} onInput={e => setRefreshSeconds(Number(e.target.value))} />
                  </Field>
                  </fieldset>
              <section class="space-y-3" aria-label="Dataset definition">
                {sourceText() === null ? <Button aria-label="Edit dataset source" variant="ghost" disabled={Boolean(busy())} onClick={() => {
                  try {
                    setSourceText(serializeDatasetDefinition(buildCatalog(connection(), false)));
                    setError("");
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not show source.");
                  }
                }}>
                    Edit source markup
                  </Button> : <div class="space-y-3">
                    <Field name="Dataset source markup">
                      <textarea aria-label="Dataset source" spellcheck={false} class={`${control} min-h-64 resize-y text-xs leading-5`} value={sourceText() ?? ""} onInput={e => setSourceText(e.target.value)} />
                    </Field>
                    <p class="text-xs text-muted">
                      Apply markup to update the visual editor. Passwords are
                      represented by secret references.
                    </p>
                    <div class="flex gap-2">
                      <Button aria-label="Apply dataset source" onClick={() => {
                      try {
                        const definition = parseDatasetDefinition(sourceText()!);
                        if (id && definition.defaultSchema !== defaultSchema()) throw new Error("The default schema of an existing dataset cannot change.");
                        loadDefinition(definition, undefined, true);
                        setSourceText(null);
                        setError("");
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Invalid dataset source.");
                      }
                    }}>
                        Apply source
                      </Button>
                      <Button aria-label="Cancel dataset source" variant="ghost" onClick={() => setSourceText(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>}
              </section>
                </div>
              </details>
              {!id && <div class="flex items-center gap-4">
                <Button aria-label="Save dataset" disabled={!title().trim() || Boolean(busy()) || sourceText() !== null} onClick={saveDataset}>
                  {busy() === "save" ? "Saving…" : "Create dataset"}
                </Button>
                {busy() && <span role="status" class="text-sm text-muted">
                    Working…
                  </span>}
              </div>}
            </div>
          </>}
      </AssetWorkspace>;
  // Direct dataset edit URLs need the same layout and styles as /datasets/new.
  return id ? <WorkspaceShell>{content}</WorkspaceShell> : content;
}
