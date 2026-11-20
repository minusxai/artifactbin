/**
 * THE DATASET BEING EDITED: its stored tables, its SQL model cells and the catalog they make, apart from the page.
 *
 * `createDatasetDraft(id)` loads an existing dataset (or a live dataset's connector, whose editor is its connection's
 * form), keeps the stored tables and model cells, and builds the one definition both the visual editor and the source
 * JSON share. A model cell is stale until it runs; every later cell goes stale with it, and a stale cell blocks a save
 * or a query of the exposed output. Saving sends only the title when the definition did not change.
 *
 * Interface: the state (`title`, `stored`, `models`, `defaultSchema`, `liveConnector`, `loading`, `loadFailed`, `busy`,
 * `error`, `sourceText`), what is exposed (`exposedTables`, `explorerCatalog`, `selectedSchemas`, `query`), and the
 * edits (`editStored`, `addStored`, `addImported`, `removeStored`, `editModel`, `updateModel`, `addModel`, `removeModel`,
 * `runCell`, `editSource`, `applySource`, `save`).
 */
import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { runtimeId } from '@artifactbin/utils/runtime-id';
import { OWN_CONNECTIONS_OFF } from '@artifactbin/contracts/connectors';
import { parseDatasetDefinition, serializeDatasetDefinition } from '@/lib/datasets/definition';
import type { CatalogInput, DatasetCatalog } from '@/lib/datasets';
import type { DatasetColumn, Row } from '@/lib/dataflow';
import { apiRequest } from '../lib/api';
import { creationDestination } from '../lib/creation-destination';
import type { CatalogPreview, CatalogQuery } from './DatasetCatalogView';
import type { ConnectorList, ListedConnector } from './LiveDatasetForm';

/** A SQL model table over the stored tables, saved as `sql`. */
export type ModelDraft = {
  cell: { id: string; name: string; sql: string };
  schema: string;
  columns: DatasetColumn[];
  selected: string[];
  stale: boolean;
  collapsed: boolean;
  preview?: CatalogPreview;
};
export type StoredDraft = {
  key: string;
  schema: string;
  name: string;
  rows: string;
  columns?: CatalogInput["tables"][number]["columns"];
  retained: boolean;
};
export type DatasetDraft = ReturnType<typeof createDatasetDraft>;

const sourceKey = (table: { schema: string; name: string }) => JSON.stringify([table.schema, table.name]);
const namesToColumns = (names: string[] = []): DatasetColumn[] => names.map(name => ({ name, type: "string" }));
const columnNames = (columns: CatalogInput["tables"][number]["columns"]) => columns?.map(c => typeof c === 'string' ? c : c.name);
/** Every cell from `from` on must run again: what it reads may have changed. */
const invalidate = (items: ModelDraft[], from: number) => items.map((item, index) => index >= from ? { ...item, stale: true, preview: undefined } : item);
const errorText = (err: unknown, fallback: string) => err instanceof Error ? err.message : fallback;

/** The rows a stored table holds, checked; a retained table left empty keeps the rows it has. */
function storedTable(s: StoredDraft): CatalogInput["tables"][number] {
  const columns = s.columns !== undefined ? { columns: s.columns } : {};
  if (!s.rows.trim() && s.retained) return { schema: s.schema, name: s.name, ...columns };
  let rows: unknown;
  try {
    rows = JSON.parse(s.rows);
  } catch {
    throw new Error(`Enter a JSON array of rows for ${s.name || "the stored table"}.`);
  }
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("Stored rows must be a JSON array of objects.");
  return { schema: s.schema, name: s.name, ...columns, rows: rows as Row[] };
}

export function createDatasetDraft(id: string | undefined) {
  const originalDefinition = { current: null as string | null };
  const [title, setTitle] = createSignal("");
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
  const datasetId = id ? { datasetId: id } : {};

  const loadDefinition = (input: CatalogInput, metadata?: DatasetCatalog) => {
    setDefaultSchema(input.defaultSchema ?? "public");
    setModels(input.tables.filter(t => t.sql !== undefined).map(t => {
      const described = metadata?.tables.find(d => d.schema === t.schema && d.name === t.name)?.columns;
      return {
        cell: { id: runtimeId(), name: t.name, sql: t.sql! },
        schema: t.schema,
        columns: described ?? namesToColumns(columnNames(t.columns)),
        selected: columnNames(t.columns) ?? described?.map(c => c.name) ?? [],
        stale: false,
        collapsed: false
      };
    }));
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
      meta: { catalog?: DatasetCatalog; connection?: { connector: string } };
      source?: string;
    }>(`/api/my/artifacts/${encodeURIComponent(id)}`).then(data => {
      if (!alive) return;
      const catalog = data.meta.catalog;
      const connection = data.meta.connection;
      if (connection) return apiRequest<ConnectorList>('/api/connections').then(list => {
        // An install whose datasets may not have their own connection offers no form to change one.
        if (list.ownConnections === false) throw new Error(OWN_CONNECTIONS_OFF.message);
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
      setError(errorText(err, "Could not reach the server."));
    } finally {
      setBusy("");
    }
  };
  const updateModel = (index: number, patch: Partial<ModelDraft["cell"]>) => setModels(items => invalidate(items.map((item, i) => i === index ? { ...item, cell: { ...item.cell, ...patch } } : item), index));
  const addModel = (after = models().length - 1) => setModels(items => {
    const next = invalidate(items, after + 1);
    let suffix = 1;
    while (items.some(item => item.cell.name === `query_${suffix}`)) suffix++;
    next.splice(after + 1, 0, {
      cell: { id: runtimeId(), name: `query_${suffix}`, sql: "" },
      schema: defaultSchema() || "public",
      columns: [],
      selected: [],
      stale: true,
      collapsed: false
    });
    return next;
  });
  const buildCatalog = (validate = true): CatalogInput => {
    const tables: CatalogInput["tables"] = stored().map(storedTable);
    for (const model of models()) {
      if (validate && model.stale) throw new Error(`Run ${model.cell.name || "the model"} again before saving or querying its exposed output.`);
      tables.push({ schema: model.schema, name: model.cell.name, sql: model.cell.sql });
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
    return { kind: "stored", defaultSchema: schema, tables };
  };
  const runCell = (index: number) => {
    const model = models()[index];
    if (busy() || sourceText() !== null || !model?.cell.name.trim() || !model.cell.sql.trim()) return;
    void run(`cell-${model.cell.id}`, async () => {
      const preview = await apiRequest<CatalogPreview>("/api/my/datasets/preview", 'POST', { dataset: buildCatalog(false), sql: model.cell.sql, ...datasetId });
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
  const exposedTables = createMemo<{ schema: string; name: string; columns?: string[] }[]>(() => [
    ...stored().filter(s => s.schema && s.name).map(s => ({ schema: s.schema, name: s.name })),
    ...models().filter(m => !m.stale).map(m => ({ schema: m.schema, name: m.cell.name, columns: m.selected })),
  ]);

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
  // Uses the latest draft at execution time; typing source/cell SQL does not itself execute final SQL. Async: an invalid
  // draft is a rejected query, which the explorer shows, never a throw.
  const query: CatalogQuery = async sql => apiRequest<CatalogPreview>("/api/my/datasets/preview", 'POST', { dataset: buildCatalog(), sql, ...datasetId });
  createEffect(() => {
    if (!id || loading() || loadFailed() || originalDefinition.current !== null) return;
    originalDefinition.current = serializeDatasetDefinition(buildCatalog(false));
  });
  const editStored = (key: string, patch: Partial<StoredDraft>) => setStored(items => items.map(s => s.key === key ? { ...s, ...patch } : s));
  const editModel = (cellId: string, patch: (model: ModelDraft) => Partial<ModelDraft>) => setModels(items => items.map(m => m.cell.id === cellId ? { ...m, ...patch(m) } : m));

  return {
    title, setTitle, stored, models, defaultSchema, setDefaultSchema, liveConnector, loading, loadFailed, busy, setBusy, error, sourceText, setSourceText,
    exposedTables, explorerCatalog,
    selectedSchemas: createMemo(() => [...new Set(exposedTables().map(t => t.schema))]),
    query,
    editStored,
    addStored: () => setStored(items => [...items, { key: runtimeId(), schema: defaultSchema() || "public", name: "", rows: "", retained: false }]),
    /** Imported rows become a new table, named from the source and kept unique in its schema. */
    addImported: (rows: unknown[], suggestedName: string) => {
      const schema = defaultSchema() || "public";
      const base = suggestedName.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'table';
      const stem = /^[a-z_]/.test(base) ? base : `table_${base}`;
      const names = new Set([...stored().filter(table => table.schema === schema).map(table => table.name), ...models().filter(model => model.schema === schema).map(model => model.cell.name)]);
      let name = stem;
      for (let suffix = 2; names.has(name); suffix++) name = `${stem}_${suffix}`;
      setStored(items => [...items, { key: runtimeId(), schema, name, rows: JSON.stringify(rows, null, 2), retained: false }]);
    },
    removeStored: (key: string) => setStored(items => items.filter(s => s.key !== key)),
    editModel,
    updateModel,
    addModel,
    removeModel: (cellId: string, index: number) => setModels(items => invalidate(items.filter(m => m.cell.id !== cellId), index)),
    runCell,
    /** Show the definition as JSON to edit by hand. */
    editSource: () => {
      try {
        setSourceText(serializeDatasetDefinition(buildCatalog(false)));
        setError("");
      } catch (err) {
        setError(errorText(err, "Could not show source."));
      }
    },
    /** The hand-edited JSON replaces the visual editor's definition. */
    applySource: () => {
      try {
        const definition = parseDatasetDefinition(sourceText()!);
        if (id && definition.defaultSchema !== defaultSchema()) throw new Error("The default schema of an existing dataset cannot change.");
        loadDefinition(definition);
        setSourceText(null);
        setError("");
      } catch (err) {
        setError(errorText(err, "Invalid dataset source."));
      }
    },
    /** Create or update the dataset, then open it. */
    save: (signedIn: boolean, onSaved?: () => Promise<unknown>) => void run("save", async () => {
      const savedTitle = title().trim();
      if (!savedTitle) throw new Error("Enter a dataset title.");
      const dataset = buildCatalog();
      setTitle(savedTitle);
      const metadataOnly = Boolean(id && serializeDatasetDefinition(dataset) === originalDefinition.current);
      const data = await apiRequest<{ id: string }>(id ? `/api/my/artifacts/${encodeURIComponent(id)}` : "/api/my/artifacts", metadataOnly ? "PATCH" : id ? "PUT" : "POST", metadataOnly ? {
        title: savedTitle,
        expectedState: state()
      } : {
        dataset,
        title: savedTitle,
        ...(id ? {
          expectedVersion: version(),
          expectedState: state()
        } : {
          visibility: signedIn ? "private" : "unlisted",
          destination: creationDestination(window.location.search),
          parent_id: new URLSearchParams(window.location.search).get('parent_id')
        })
      });
      await onSaved?.();
      // Cross the app entry after consumers have read the save response.
      // A same-task document navigation can discard its body in Chromium.
      await new Promise(resolve => setTimeout(resolve, 250));
      window.location.assign(`/a/${data.id}`);
    }),
  };
}
