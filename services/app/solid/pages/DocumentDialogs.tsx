/* @jsxImportSource solid-js */
/**
 * THE DOCUMENT PAGE'S DISCUSSION-LAYER DIALOGS: sharing, settings and the social preview editor, each loaded on first use.
 *
 * `createDocumentDialogs` holds which of them is up; the social preview first loads the head it edits (an error is shown
 * in place of the editor). `<DocumentDialogs>` draws them where the page puts it (inside its discussion overlay).
 *
 * Interface: `createDocumentDialogs({ backend, editable })` → `{ sharingOpen, openSharing, openSettings, openSocialPreview }`,
 * and `<DocumentDialogs dialogs … />`.
 */
import { createSignal, lazy, Show, Suspense, type JSX } from 'solid-js';
import type { ReaderArtifactBackend } from '@/lib/artifact-backend';
import { PendingReaderDialog } from '../document/PendingReaderDialog';

/** Loaded on first use. */
const DocumentSharing = lazy(() => import('../document/DocumentSharing').then(m => ({ default: m.DocumentSharing })));
const DocumentSettings = lazy(() => import('../document/DocumentSettings'));
const SocialPreviewEditor = lazy(() => import('../document/SocialPreviewEditor').then((m) => ({ default: m.SocialPreviewEditor })));

export function createDocumentDialogs(options: { backend: ReaderArtifactBackend | null; editable: () => boolean }) {
  const [sharingOpen, setSharingOpen] = createSignal(false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [socialPreviewOpen, setSocialPreviewOpen] = createSignal(false);
  const [previewHead, setPreviewHead] = createSignal<{ source: string; editId: string; version: number } | null>(null);
  const [metadataError, setMetadataError] = createSignal<string | null>(null);
  const openSocialPreview = async () => {
    const backend = options.backend;
    if (!backend || !options.editable()) return;
    setMetadataError(null);
    try {
      const head = await backend.load();
      if (!head) throw new Error('Social preview is unavailable. Refresh and try again.');
      setPreviewHead({ source: head.html ?? '', editId: head.edit_id, version: head.version });
      setSocialPreviewOpen(true); setSharingOpen(false);
    } catch (cause) { setMetadataError(cause instanceof Error ? cause.message : 'Could not load social preview.'); }
  };
  return {
    sharingOpen, settingsOpen, socialPreviewOpen, previewHead, metadataError,
    openSharing: () => setSharingOpen(true),
    closeSharing: () => setSharingOpen(false),
    openSettings: () => setSettingsOpen(true),
    closeSettings: () => setSettingsOpen(false),
    closeSocialPreview: () => setSocialPreviewOpen(false),
    openSocialPreview,
    hasBackend: Boolean(options.backend),
  };
}

export function DocumentDialogs(props: {
  dialogs: ReturnType<typeof createDocumentDialogs>;
  id: string;
  title: string;
  refs?: Array<{ id: string; kind: string; title?: string | null }>;
  owner: boolean;
  editable: boolean;
  queryApprovals: boolean;
  version: number;
  onPwaEnabledChange: (enabled: boolean) => void;
}): JSX.Element {
  const dialogs = props.dialogs;
  return <>
    <Show when={dialogs.sharingOpen()}>
      <Suspense fallback={<PendingReaderDialog title="Share artifact" onClose={dialogs.closeSharing} />}><DocumentSharing refs={props.refs} id={props.id} title={props.title} owner={props.owner} editable={props.editable} queryApprovals={props.queryApprovals} variant="dialog" version={props.version}
        onClose={dialogs.closeSharing} onSocialPreview={props.editable ? () => void dialogs.openSocialPreview() : undefined} /></Suspense>
    </Show>
    <Show when={dialogs.metadataError()}><p role="alert">{dialogs.metadataError()}</p></Show>
    <Show when={dialogs.settingsOpen() && dialogs.hasBackend}><Suspense fallback={null}><DocumentSettings id={props.id} title={props.title} onPwaEnabledChange={props.onPwaEnabledChange} onClose={dialogs.closeSettings} /></Suspense></Show>
    <Show when={dialogs.socialPreviewOpen() && dialogs.previewHead()}>{(head) => <Suspense fallback={null}><SocialPreviewEditor id={props.id} source={head().source} editId={head().editId} version={head().version} onClose={dialogs.closeSocialPreview} /></Suspense>}</Show>
  </>;
}
