/* @jsxImportSource solid-js */
/**
 * THE DOCUMENT PAGE'S DIALOGS: sharing, settings and the social preview editor, each its own lazy chunk too. This module
 * is loaded once one is asked for (./document-dialog-state holds which); the page draws it inside its discussion overlay.
 *
 * Interface: `<DocumentDialogs dialogs id title refs owner editable queryApprovals version onPwaEnabledChange />`.
 */
import { lazy, Show, Suspense, type JSX } from 'solid-js';
import { PendingReaderDialog } from '../document/PendingReaderDialog';
import type { createDocumentDialogs } from './document-dialog-state';

const DocumentSharing = lazy(() => import('../document/DocumentSharing').then(m => ({ default: m.DocumentSharing })));
const DocumentSettings = lazy(() => import('../document/DocumentSettings'));
const SocialPreviewEditor = lazy(() => import('../document/SocialPreviewEditor').then((m) => ({ default: m.SocialPreviewEditor })));

export default function DocumentDialogs(props: {
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
    <Show when={dialogs.open() === 'sharing'}>
      <Suspense fallback={<PendingReaderDialog title="Share artifact" onClose={dialogs.close} />}><DocumentSharing refs={props.refs} id={props.id} title={props.title} owner={props.owner} editable={props.editable} queryApprovals={props.queryApprovals} variant="dialog" version={props.version}
        onClose={dialogs.close} onSocialPreview={props.editable ? () => void dialogs.openSocialPreview() : undefined} /></Suspense>
    </Show>
    <Show when={dialogs.open() === 'settings'}><Suspense fallback={null}><DocumentSettings id={props.id} title={props.title} onPwaEnabledChange={props.onPwaEnabledChange} onClose={dialogs.close} /></Suspense></Show>
    <Show when={dialogs.open() === 'social' && dialogs.previewHead()}>{(head) => <Suspense fallback={null}><SocialPreviewEditor id={props.id} source={head().source} editId={head().editId} version={head().version} onClose={dialogs.close} /></Suspense>}</Show>
  </>;
}
