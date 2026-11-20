/* @jsxImportSource solid-js */
/**
 * THE DATASET EDITOR'S SOURCE STEPS, each drawn from the one draft (dataset-draft.ts).
 *
 * `RawDataStep` imports CSV or Google Sheets or takes pasted JSON rows; `ModelsStep` is the notebook of SQL model
 * cells; `WhitelistStep` lists what a reader of the dataset will get; `AdvancedStep` holds the default schema and the
 * definition as hand-editable JSON. The page (pages/DatasetEditor.tsx) lays them out and owns saving.
 *
 * Interface: `RawDataStep`, `ModelsStep`, `WhitelistStep`, `AdvancedStep`, each `{ draft }` (and the dataset id where
 * the step differs for an existing dataset).
 */
import { createSignal, type JSX } from "solid-js";
import { ChevronDown, ChevronRight, Plus, Play, Code2 } from "lucide-solid";
import { Button } from "../ui/Button";
import { Disclosure } from "../ui/Disclosure";
import { Field, Input, Textarea } from "../ui/Field";
import { Panel } from "../ui/Panel";
import { Select } from "../ui/Select";
import { Tabs } from "../ui/Tabs";
import { CatalogRows } from "./DatasetCatalogView";
import { DatasetImport } from "./DatasetImport";
import StepHeader from "./StepHeader";
import type { DatasetDraft } from "./dataset-draft";

/** Step 1: the stored tables, from an import or pasted JSON rows. */
export function RawDataStep(props: { draft: DatasetDraft; initialInput: "csv" | "sheet" | "json" }): JSX.Element {
  const draft = props.draft;
  const [input, setInput] = createSignal(props.initialInput);
  return <Panel label="Raw data" padding="none" class="overflow-hidden">
    <StepHeader n={1} title="Raw data">
      Import CSV or Google Sheets, or paste JSON rows.
    </StepHeader>
    <Tabs label="Raw data source" class="overflow-x-auto px-4 sm:gap-5 sm:px-5" value={input()}
      items={([["csv", "CSV"], ["sheet", "Google Sheets"], ["json", "JSON"]] as const).map(([value, label]) => ({ value, label }))}
      onChange={key => setInput(key as "csv" | "sheet" | "json")} />
    {/* Keep source controls at a stable height; added tables scroll below them. */}
    <div class="h-[22rem] overflow-y-auto p-4 sm:p-5">
      <section aria-label="Stored tables editor" class="space-y-4">
        {input() !== "json" && <DatasetImport source={input() === "sheet" ? "sheet" : "csv"} disabled={Boolean(draft.busy())} onBusyChange={value => draft.setBusy(value ? "import" : "")} onImported={draft.addImported} />}
        {input() === "json" && <div class="space-y-3">
          <p class="text-xs text-muted">Add a table and paste a JSON array of objects, for example [{"{"}&quot;id&quot;: 1{"}"}].</p>
          <Button aria-label="Add JSON table" variant="secondary" onClick={draft.addStored}>Add JSON table</Button>
        </div>}
        {!!draft.stored().length && <p class="text-xs font-medium text-fg">Tables in this dataset · {draft.stored().length}</p>}
        {draft.stored().map((table, index) => <div class="space-y-3 border-t border-edge pt-4">
          <div class="grid gap-3 sm:grid-cols-2">
            <Field label="Schema">
              <Input aria-label={`Stored schema ${index + 1}`} disabled={table.retained} value={table.schema} onInput={e => draft.editStored(table.key, { schema: e.target.value })} />
            </Field>
            <Field label="Table name">
              <Input aria-label={`Stored table name ${index + 1}`} disabled={table.retained} value={table.name} onInput={e => draft.editStored(table.key, { name: e.target.value })} />
            </Field>
          </div>
          <Field label={table.retained ? "Replace rows (optional)" : "Rows"}>
            <Textarea size="sm" rows={8} aria-label={`Stored rows ${index + 1}`} spellcheck={false} value={table.rows} placeholder='[{"id": 1}]' onInput={e => draft.editStored(table.key, { rows: e.target.value })} />
          </Field>
          <Button aria-label={`Remove stored table ${index + 1}`} variant="secondary" onClick={() => draft.removeStored(table.key)}>
            Remove table
          </Button>
        </div>)}
      </section>
    </div>
  </Panel>;
}

/** Step 2: the notebook of SQL model cells, each run to see (and expose) its output. */
export function ModelsStep(props: { draft: DatasetDraft }): JSX.Element {
  const draft = props.draft;
  return <Panel label="Data models notebook" padding="none" class="overflow-hidden">
    <StepHeader n={2} title="Data models">
      Save SQL queries over your tables as named model tables.
    </StepHeader>
    <div class="space-y-4 p-3 sm:p-4">
      {!draft.models().length && <div class="rounded-panel border border-dashed border-edge p-5 text-center">
        <Code2 size={20} class="mx-auto mb-2 text-faint" />
        <p class="text-sm text-muted">
          Start with a query, build on it in the next cell.
        </p>
        <p class="mt-1 text-xs text-faint">
          Optional — you can expose raw tables directly.
        </p>
      </div>}
      {draft.models().map((model, index) => <article aria-label={`Notebook cell ${index + 1}`} class="min-w-0 overflow-hidden rounded-panel border border-edge bg-bg/30">
        <header class="flex flex-wrap items-center gap-2 border-b border-edge bg-raised/30 p-2.5">
          <Button variant="secondary" size="sm" icon aria-label={`Collapse cell ${index + 1}`} aria-expanded={!model.collapsed} onClick={() => draft.editModel(model.cell.id, m => ({ collapsed: !m.collapsed }))}>
            {model.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </Button>
          <span class="font-mono text-xs text-faint">
            {String(index + 1).padStart(2, "0")}
          </span>
          <Input size="sm" aria-label={`Cell name ${index + 1}`} class="min-w-24 max-w-64 flex-1" placeholder="model_name" value={model.cell.name} onInput={e => draft.updateModel(index, { name: e.target.value })} />
          <Button aria-label={`Run cell ${index + 1}`} aria-keyshortcuts="Meta+Enter Control+Enter" variant="secondary" size="sm" disabled={!model.cell.name.trim() || !model.cell.sql.trim()} onClick={() => draft.runCell(index)}>
            <Play size={12} />
            Run
          </Button>
        </header>
        {!model.collapsed && <div class="space-y-3 p-3">
          <Field label="Model schema">
            <Input size="sm" aria-label={`Model schema ${index + 1}`} value={model.schema} onInput={e => draft.editModel(model.cell.id, () => ({ schema: e.target.value }))} />
          </Field>
          <Textarea size="sm" rows={6} aria-label={`Cell SQL ${index + 1}`} spellcheck={false} onKeyDown={event => {
            if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.repeat || event.isComposing || event.keyCode === 229 || event.currentTarget.matches(":disabled") || draft.busy() || draft.sourceText() !== null) return;
            event.preventDefault();
            draft.runCell(index);
          }} class="resize-y leading-6" placeholder={index ? `SELECT * FROM ${draft.models()[index - 1].cell.name || "previous_cell"}` : "SELECT * FROM public.orders"} value={model.cell.sql} onInput={e => draft.updateModel(index, { sql: e.target.value })} />
          <p class="text-2xs text-faint">
            Run this cell with{" "}
            <kbd class="font-mono">⌘ Enter</kbd> or{" "}
            <kbd class="font-mono">Ctrl Enter</kbd>.
          </p>
          {model.preview ? <CatalogRows result={model.preview} label={`Cell preview ${index + 1}`} /> : <p class="text-xs text-faint">
            {model.stale ? "Run this cell to inspect its current output columns." : `${model.columns.length} saved output columns · run to preview rows`}
          </p>}
          <div class="flex flex-wrap justify-between gap-2">
            <Button aria-label={`Insert cell after ${index + 1}`} variant="secondary" size="sm" onClick={() => draft.addModel(index)}>
              <Plus size={12} />
              Insert cell below
            </Button>
            <Button aria-label={`Remove cell ${index + 1}`} variant="secondary" size="sm" onClick={() => draft.removeModel(model.cell.id, index)}>
              Remove
            </Button>
          </div>
        </div>}
      </article>)}
      <Button aria-label="Add notebook cell" variant="secondary" onClick={() => draft.addModel()}>
        <Plus size={14} />
        Add SQL cell
      </Button>
    </div>
  </Panel>;
}

/** Step 3: a stored table is exposed whole, and a model once its cell has run: what a reader of the dataset will get. */
export function WhitelistStep(props: { draft: DatasetDraft }): JSX.Element {
  return <Panel label="Exposed tables" padding="none" class="overflow-hidden">
    <StepHeader n={3} title="Whitelist">
      Tables are exposed whole, and a model is exposed once its cell has run.
    </StepHeader>
    <div class="p-4 sm:p-5">
      {props.draft.exposedTables().length ? <ul class="grid gap-2 sm:grid-cols-2">
        {props.draft.exposedTables().map(table => <li class="flex items-center justify-between gap-3 rounded-control border border-edge bg-raised/40 px-3 py-2 text-xs">
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
  </Panel>;
}

/** The default schema (fixed once the dataset exists) and the definition as JSON. */
export function AdvancedStep(props: { draft: DatasetDraft; existing: boolean }): JSX.Element {
  const draft = props.draft;
  return <Panel padding="none" class="overflow-hidden"><Disclosure inset summary={<>
      <span class="text-sm font-semibold text-fg">Advanced</span>
      <span class="text-xs font-normal text-muted">default schema · source JSON</span>
    </>}>
    <div class="space-y-5 border-t border-edge p-4 sm:p-5">
      <fieldset disabled={Boolean(draft.busy()) || draft.sourceText() !== null} class="grid gap-4 sm:grid-cols-2">
        <Field label="Default schema" hint="Assumed when a table is named without a schema, in model SQL and in agent edits. Fixed once the dataset is created.">
          <Select ariaLabel="Default schema" disabled={props.existing} value={draft.defaultSchema()} onChange={draft.setDefaultSchema}
            options={[{ value: "", label: `Automatic (${draft.selectedSchemas()[0] ?? "public"})` }, ...[...new Set([...draft.selectedSchemas(), ...(draft.defaultSchema() ? [draft.defaultSchema()] : [])])].map(schema => ({ value: schema, label: schema }))]} />
        </Field>
      </fieldset>
      <section class="space-y-3" aria-label="Dataset definition">
        {draft.sourceText() === null ? <Button aria-label="Edit dataset source" variant="secondary" disabled={Boolean(draft.busy())} onClick={draft.editSource}>
          Edit source JSON
        </Button> : <div class="space-y-3">
          <Field label="Dataset source JSON">
            <Textarea size="sm" rows={12} aria-label="Dataset source" spellcheck={false} class="resize-y" value={draft.sourceText() ?? ""} onInput={e => draft.setSourceText(e.target.value)} />
          </Field>
          <p class="text-xs text-muted">
            The definition as JSON: "kind", "defaultSchema" and "tables", each with "schema", "name" and its "columns", "rows" or "sql". Apply it to update the visual editor.
          </p>
          <div class="flex gap-2">
            <Button aria-label="Apply dataset source" onClick={draft.applySource}>
              Apply source
            </Button>
            <Button aria-label="Cancel dataset source" variant="secondary" onClick={() => draft.setSourceText(null)}>
              Cancel
            </Button>
          </div>
        </div>}
      </section>
    </div>
  </Disclosure></Panel>;
}
