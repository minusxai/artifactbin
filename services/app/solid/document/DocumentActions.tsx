/* @jsxImportSource solid-js */
import { createSignal, lazy, Show, Suspense, type JSX } from 'solid-js';
import MessageSquare from 'lucide-solid/icons/message-square';
import Pencil from 'lucide-solid/icons/pencil';
import { DeleteAction } from './DeleteAction';
import { InstallArtifactLink } from './InstallArtifact';
import { DownloadOffline } from './DownloadOffline';
import { DocumentSharing } from './DocumentSharing';
import { ForkArtifact } from './ForkArtifact';
import { LikeAction } from './LikeAction';
import { VersionHistory, type VersionHistoryProps } from './VersionHistory';
import { DocumentPeople } from './DocumentPeople';
import { RefreshDocumentAssets } from './RefreshDocumentAssets';
/** The crop editor parses the document's source: its own chunk, never the reader's (lib/__tests__/reader-bundle-hygiene). */
const SocialPreviewEditor = lazy(() => import('./SocialPreviewEditor').then((m) => ({ default: m.SocialPreviewEditor })));

const ROW = 'flex w-full items-center gap-2 rounded-[5px] border-0 bg-transparent px-2 py-2 text-left font-mono text-xs text-muted hover:bg-raised hover:text-fg';
export interface DocumentActionsProps {
  pwaEnabled?: boolean; membershipAvailable?: boolean;
  id: string; title: string; version: number; archived?: boolean;
  owner: boolean; canEdit: boolean; canAnnotate: boolean; accountSession: boolean;
  like: { liked: boolean; count: number }; onCommentsChange: (open: boolean) => void;
  commentsOpen?: boolean; openAnnotations?: number; onEdit?: () => void;
  onDeleted?: () => void; history?: VersionHistoryProps;
  membershipRevision?: number; onMembershipChange?: () => void; invitationLanding?: boolean;
  forkedFrom?: { label: string; href?: string | null } | null;
  /** Only a loaded markup source lets an editor open the social preview crop editor (SocialPreviewEditor). */
  format?: string; source?: string | null; editId?: string;
  /** The caller's own chrome already offers a direct fork action (e.g. the reader rail): skip this panel's own, so settings never duplicates it. */
  hideFork?: boolean;
  /** Open the page's sharing dialog (the panel closes under it). */
  onShare?: () => void;
}
/** Controls own only panel state; the document page owns editing and annotation lifetimes. */
export function DocumentActions(props: DocumentActionsProps): JSX.Element {
  const [commentsOpen, setCommentsOpen] = createSignal(props.commentsOpen ?? false);
  const [socialPreviewOpen, setSocialPreviewOpen] = createSignal(false);
  const activeOwner = () => props.owner && !props.archived;
  const activeEditor = () => props.canEdit && !props.archived;
  const activeCommenter = () => props.canAnnotate && !props.archived;
  const canPreview = () => activeEditor() && props.format === 'markup' && props.source != null && !!props.editId;
  const onSocialPreview = () => canPreview() ? () => setSocialPreviewOpen(true) : undefined;
  const toggleComments = () => { const open = !commentsOpen(); setCommentsOpen(open); props.onCommentsChange(open); };
  return <div class="space-y-4" aria-label="Document actions">
    <Show when={props.membershipAvailable}><DocumentPeople id={props.id} revision={props.membershipRevision} onChange={props.onMembershipChange} initialOpen={props.invitationLanding} hideJoin /></Show>
    <section aria-label="Document actions" class="space-y-1">
      <h2 class="px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Artifact</h2>
      <Show when={props.forkedFrom}>{source => <p data-mx-forked-from class="px-2 py-2 font-mono text-xs text-muted">forked from <Show when={source().href} fallback={source().label}>{href => <a href={href()} aria-label="Open the artifact this was forked from" class="underline">{source().label}</a>}</Show></p>}</Show>
      <Show when={activeCommenter()}><button type="button" aria-label="Toggle comments" aria-pressed={commentsOpen()} onClick={toggleComments} class={ROW}><MessageSquare size={14} /><span class="flex-1">{commentsOpen() ? 'close comments' : 'comments'}</span><Show when={props.openAnnotations}><span>{props.openAnnotations}</span></Show></button></Show>
      <Show when={activeEditor()}><button type="button" aria-label="Edit artifact" onClick={props.onEdit} class={ROW}><Pencil size={14} />edit artifact</button></Show>
      <Show when={props.pwaEnabled && !props.archived}><InstallArtifactLink id={props.id} class={ROW} /></Show>
      <DownloadOffline id={props.id} version={props.archived ? props.version : undefined} />
      <Show when={!props.hideFork}><ForkArtifact id={props.id} title={props.title} /></Show>
      <LikeAction id={props.id} accountSession={props.accountSession} initial={props.like} />
    </section>
    <Show when={activeOwner()}><section aria-label="Owner actions" class="space-y-1"><h2 class="px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">owner</h2>
      <RefreshDocumentAssets id={props.id} />
      <DocumentSharing id={props.id} title={props.title} owner onSocialPreview={onSocialPreview()} variant="menu" onOpen={props.onShare} />
      <Show when={props.onDeleted}><DeleteAction id={props.id} title={props.title} onDeleted={props.onDeleted!} /></Show>
    </section></Show>
    <Show when={!activeOwner() && activeEditor()}><DocumentSharing id={props.id} title={props.title} owner={false} editable onSocialPreview={onSocialPreview()} variant="menu" onOpen={props.onShare} /></Show>
    <Show when={props.history}>{history => <VersionHistory {...history()} />}</Show>
    <Show when={socialPreviewOpen() && props.source != null && props.editId}>
      <Suspense fallback={null}><SocialPreviewEditor id={props.id} source={props.source!} editId={props.editId!} version={props.version} onClose={() => setSocialPreviewOpen(false)} /></Suspense>
    </Show>
  </div>;
}
