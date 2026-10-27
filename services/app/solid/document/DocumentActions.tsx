/* @jsxImportSource solid-js */
import { createSignal, lazy, Show, Suspense, type JSX } from 'solid-js';
import { Button } from '../ui/Button';
import { MicroLabel } from '../ui/ui';
import Settings from 'lucide-solid/icons/settings';
import Users from 'lucide-solid/icons/users';
import Image from 'lucide-solid/icons/image';
import FolderInput from 'lucide-solid/icons/folder-input';
import MessageSquare from 'lucide-solid/icons/message-square';
import { RenameDocument } from './RenameDocument';
import { DeleteAction } from './DeleteAction';
import { InstallArtifactLink } from './InstallArtifact';
import { DownloadOffline } from './DownloadOffline';
import { DocumentSharing } from './DocumentSharing';
import { ForkArtifact } from './ForkArtifact';
import { LikeAction } from './LikeAction';

/**
 * Lazy on purpose (a documented lazy-import exception): only an owner who picks "transfer ownership" needs the
 * dialog, and every reader's document page would otherwise download it (the page-speed prose budget).
 */
/** Lazy on purpose (a documented lazy-import exception): the People panel only draws once its row is opened, and the reader's document page must stay within the page-speed prose budget. */
const DocumentPeople = lazy(() => import('./DocumentPeople').then((m) => ({ default: m.DocumentPeople })));
const DocumentDesignSystem = lazy(() => import('./DocumentDesignSystem').then((m) => ({ default: m.DocumentDesignSystem })));
const TransferOwnershipDialog = lazy(() => import('../components/TransferOwnershipDialog').then((m) => ({ default: m.TransferOwnershipDialog })));
import { RefreshDocumentAssets } from './RefreshDocumentAssets';

/** Every row of the controls panel is a ghost `sm` Button (a link row takes `href`), lower-case, with one 14px icon. */
const ROW_BUTTON = 'w-full justify-start';
interface DocumentActionsProps {
  /** An HTML page's design-system control (solid/document/DocumentDesignSystem), for its editors. */
  designSystem?: import('./DocumentDesignSystem').DesignSystemHost;
  groupId?:string|null;
  pwaEnabled?: boolean; membershipAvailable?: boolean;
  id: string; title: string; version: number; archived?: boolean;
  owner: boolean; canEdit: boolean; canAnnotate: boolean; accountSession: boolean;
  like: { liked: boolean; count: number }; onCommentsChange: (open: boolean) => void;
  commentsOpen?: boolean; openAnnotations?: number;
  onSettings?: () => void;
  onSocialPreview?: () => void;
  onRenamed?: (title: string) => void;
  onDeleted?: () => void;
  membershipRevision?: number; onMembershipChange?: () => void;
  forkedFrom?: { label: string; href?: string | null } | null;
  /** The caller's own chrome already offers a direct fork action (e.g. the reader rail): skip this panel's own, so settings never duplicates it. */
  hideFork?: boolean;
  /** Open the page's sharing dialog (the panel closes under it). */
  onShare?: () => void;
}
/** Controls own only panel state; the document page owns editing and annotation lifetimes. */
export function DocumentActions(props: DocumentActionsProps): JSX.Element {
  const [peopleOpen, setPeopleOpen] = createSignal(false);
  const [transferring,setTransferring]=createSignal(false);
  const [commentsOpen, setCommentsOpen] = createSignal(props.commentsOpen ?? false);
  const activeOwner = () => props.owner && !props.archived;
  const activeEditor = () => props.canEdit && !props.archived;
  const activeCommenter = () => props.canAnnotate && !props.archived;
  const toggleComments = () => { const open = !commentsOpen(); setCommentsOpen(open); props.onCommentsChange(open); };
  return <div class="space-y-4" aria-label="Document actions">
    <Show when={activeEditor() && props.designSystem}>{host => <Suspense fallback={null}><DocumentDesignSystem id={props.id} host={host()} /></Suspense>}</Show>
    <Show when={props.membershipAvailable || peopleOpen()}><Suspense fallback={null}><DocumentPeople id={props.id} revision={props.membershipRevision} onChange={props.onMembershipChange} initialOpen={peopleOpen()} hideJoin /></Suspense></Show>
    <section aria-label="Document actions" class="space-y-1">
      <h2 class="px-2"><MicroLabel>Artifact</MicroLabel></h2>
      <Show when={props.forkedFrom}>{source => <p data-mx-forked-from class="px-2 py-2 font-mono text-xs text-muted">forked from <Show when={source().href} fallback={source().label}>{href => <a href={href()} aria-label="Open the artifact this was forked from" class="underline">{source().label}</a>}</Show></p>}</Show>
      <Show when={!props.archived && props.accountSession}><Button variant="ghost" size="sm" class={ROW_BUTTON} aria-label="People" onClick={() => setPeopleOpen((open) => !open)}><Users size={14} />people</Button></Show>
      <Show when={activeEditor() && props.onSettings}><Button variant="ghost" size="sm" class={ROW_BUTTON} aria-label="Artifact settings" onClick={props.onSettings}><Settings size={14} />artifact settings</Button></Show>
      <Show when={activeEditor() && props.onSocialPreview}><Button variant="ghost" size="sm" class={ROW_BUTTON} aria-label="Edit social preview" onClick={props.onSocialPreview}><Image size={14} />social preview</Button></Show>
      <Show when={activeEditor() && props.onRenamed}><RenameDocument id={props.id} title={props.title} onRenamed={props.onRenamed!} /></Show>
      <Show when={activeCommenter()}><Button variant="ghost" size="sm" aria-label="Toggle comments" aria-pressed={commentsOpen()} onClick={toggleComments} class={ROW_BUTTON}><MessageSquare size={14} /><span class="flex-1 text-left">{commentsOpen() ? 'close comments' : 'comments'}</span><Show when={props.openAnnotations}><span>{props.openAnnotations}</span></Show></Button></Show>
      <Show when={props.pwaEnabled && !props.archived}><InstallArtifactLink id={props.id} look="row" /></Show>
      <DownloadOffline id={props.id} version={props.archived ? props.version : undefined} />
      <Show when={!props.hideFork}><ForkArtifact id={props.id} title={props.title} /></Show>
      <LikeAction id={props.id} accountSession={props.accountSession} initial={props.like} />
    </section>
    <Show when={activeOwner()}><section aria-label="Owner actions" class="space-y-1"><h2 class="px-2"><MicroLabel>owner</MicroLabel></h2>
      <Button variant="ghost" size="sm" class={ROW_BUTTON} aria-label={`Transfer ownership of ${props.title}`} onClick={()=>setTransferring(true)}><FolderInput size={14} />transfer ownership</Button>
      <RefreshDocumentAssets id={props.id} />
      <DocumentSharing id={props.id} title={props.title} owner variant="menu" onOpen={props.onShare} />
      <Show when={props.onDeleted}><DeleteAction id={props.id} title={props.title} onDeleted={props.onDeleted!} /></Show>
    </section></Show>
    <Show when={!activeOwner() && activeEditor()}><DocumentSharing id={props.id} title={props.title} owner={false} editable variant="menu" onOpen={props.onShare} /></Show>
    <Show when={transferring()}><Suspense><TransferOwnershipDialog id={props.id} title={props.title} currentGroupId={props.groupId} onClose={()=>setTransferring(false)} onTransferred={()=>window.location.assign(`/a/${encodeURIComponent(props.id)}`)}/></Suspense></Show>
  </div>;
}
