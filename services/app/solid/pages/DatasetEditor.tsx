/* @jsxImportSource solid-js */
/**
 * THE STORED DATASET EDITOR: a new dataset at /datasets/new, an existing one at /a/<id>/edit.
 *
 * The draft (datasets/dataset-draft.ts) holds the definition; the source steps (datasets/DatasetEditorSteps.tsx) edit it.
 * This page lays them out beside the explorer, sharing and data actions, and saves. A live dataset's editor is its
 * connection's form instead.
 */
import { AssetWorkspace, type AssetSection } from '../datasets/AssetWorkspace';
import WorkspaceShell from '../components/WorkspaceShell';
import { DocumentSharing } from '../document/DocumentSharing';
import { LiveDatasetForm } from '../datasets/LiveDatasetForm';
import { DatasetPolicies } from "../datasets/DatasetPolicies";
import { createSignal, Show } from "solid-js";
import { Navigate, useParams } from "@solidjs/router";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Field";
import { Panel } from "../ui/Panel";
import { StatusMessage } from "../ui/StatusMessage";
import { DatasetExplorer } from "../datasets/DatasetCatalogView";
import { createDatasetDraft } from "../datasets/dataset-draft";
import { AdvancedStep, ModelsStep, RawDataStep, WhitelistStep } from "../datasets/DatasetEditorSteps";
import { useSession } from '../lib/session';
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
  const draft = createDatasetDraft(id);
  const { title, busy, sourceText, loading, loadFailed } = draft;
  if (!id && session() && !session()?.user) return <Navigate href={`/login?callbackUrl=${encodeURIComponent(id ? `/a/${id}/edit` : "/datasets/new")}`} />;
  const [policySaveTarget, setPolicySaveTarget] = createSignal<HTMLElement>();
  const saveDataset = () => draft.save(Boolean(session()?.user), onSaved);
  const content =
      <AssetWorkspace workspace="Dataset" tabs={loading() || loadFailed() ? [] : ['source', 'data', ...(id ? ['actions' as const] : []), ...(id ? ['sharing' as const] : [])]} active={section()} onSelect={setSection}
        actions={id && !loading() && !loadFailed() ? <div class="flex items-center gap-3 py-1">
          <Button variant="secondary" href={`/a/${id}`} aria-label="Cancel editing">Cancel</Button>
          <span hidden={section() !== 'actions'} ref={setPolicySaveTarget} />
          <span hidden={section() === 'actions' || section() === 'sharing'}><Button aria-label="Save dataset" disabled={!title().trim() || Boolean(busy()) || sourceText() !== null} onClick={saveDataset}>{busy() === 'save' ? 'Saving…' : 'Save'}</Button></span>
        </div> : undefined}>
        {draft.error() && <p role="alert" aria-label="Dataset error" class="rounded-panel border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
            {draft.error()}
          </p>}
        {loading() ? <StatusMessage kind="loading">Loading dataset…</StatusMessage> : loadFailed() ? <p class="text-sm text-muted">
            The dataset could not be opened for editing.
          </p> : <>
            <div hidden={section() !== "source"} class="mx-auto max-w-4xl space-y-6">
              <fieldset disabled={Boolean(busy()) || sourceText() !== null} class="min-w-0 space-y-6">
                <Field label="Dataset title (required)">
                  <Input required aria-label="Dataset title" value={title()} onInput={e => draft.setTitle(e.target.value)} placeholder="Weekly sales" />
                </Field>
                <RawDataStep draft={draft} initialInput={id ? "json" : initialSource ?? "csv"} />
                <ModelsStep draft={draft} />
                <WhitelistStep draft={draft} />
              </fieldset>
            </div>
            <div hidden={section() !== "data"}><Panel padding="none" class="overflow-hidden">
              <header class="border-b border-edge px-4 py-3">
                <h2 class="text-sm font-semibold text-fg">
                  Explore exposed data
                </h2>
              </header>
              <DatasetExplorer catalog={draft.explorerCatalog()} query={draft.query} paginate={false} />
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
              <AdvancedStep draft={draft} existing={Boolean(id)} />
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
  return id ? <WorkspaceShell><Show when={draft.liveConnector()} fallback={content}>{connector => <div class="px-4 py-8"><LiveDatasetForm connector={connector()} datasetId={id} /></div>}</Show></WorkspaceShell> : content;
}
