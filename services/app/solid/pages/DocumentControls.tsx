/* @jsxImportSource solid-js */
/**
 * THE DOCUMENT BAR'S CONTROLS PANEL: who is reading and how this reader shows (ReaderPresenceControls), then the
 * document's actions (DocumentActions). A lazy chunk: the panel opens only when pressed, so the app shell before the
 * document frame is ready carries none of it. Each action that leaves the panel closes it first.
 *
 * Interface: `<DocumentControls close presence answer … />`, the page's state as it stands.
 */
import type { JSX } from 'solid-js';
import { DocumentActions } from '../document/DocumentActions';
import { ReaderPresenceControls } from '../document/ReaderPresenceControls';
import type { createReaderPresence } from '../document/create-reader-presence';
import type { DesignSystemHost } from '../document/DocumentDesignSystem';

export default function DocumentControls(props: {
  close: () => void;
  presence: ReturnType<typeof createReaderPresence>;
  /** The page's answer: its design system, group, app and membership settings, likes and fork origin. */
  answer: {
    surface?: { theme?: string | null; group_id?: string | null; pwaEnabled?: boolean; membershipAvailable?: boolean; author?: { forkedFrom?: { label: string; href: string | null } | null } | null };
    like?: { liked: boolean; count: number };
  };
  design: Omit<DesignSystemHost, 'value'>;
  id: string; title: string; version: number; archived: boolean;
  owner: boolean; canEdit: boolean; canAnnotate: boolean; accountSession: boolean; phone: boolean;
  likeUnavailable?: boolean;
  commentsOpen: boolean; openAnnotations: number; membershipRevision: number;
  onCommentsChange: (open: boolean) => void;
  onMembershipChange: () => void;
  onSettings: () => void;
  onSocialPreview: () => void;
  onRenamed: (title: string) => void;
  onShare: () => void;
  onHandToAgent?: () => void;
}): JSX.Element {
  const leave = (action: () => void) => () => { props.close(); action(); };
  const surface = () => props.answer.surface;
  return <>
    <ReaderPresenceControls preferences={props.presence.preferences()} onChange={props.presence.setPreference} viewers={props.presence.viewers()} total={props.presence.total()} />
    <DocumentActions designSystem={{ ...props.design, value: surface()?.theme ?? null }} groupId={surface()?.group_id} pwaEnabled={surface()?.pwaEnabled} membershipAvailable={surface()?.membershipAvailable}
      id={props.id} title={props.title} version={props.version} archived={props.archived}
      onSettings={leave(props.onSettings)} onSocialPreview={leave(props.onSocialPreview)} onRenamed={props.onRenamed}
      owner={props.owner} canEdit={props.canEdit} canAnnotate={props.canAnnotate} accountSession={props.accountSession}
      like={props.answer.like ?? { liked: false, count: 0 }} likeUnavailable={props.likeUnavailable} commentsOpen={props.commentsOpen} onCommentsChange={(open) => { props.close(); props.onCommentsChange(open); }}
      openAnnotations={props.openAnnotations} forkedFrom={surface()?.author?.forkedFrom ?? null} hideFork={!props.phone}
      membershipRevision={props.membershipRevision} onMembershipChange={props.onMembershipChange}
      onShare={leave(props.onShare)}
      onHandToAgent={props.onHandToAgent ? leave(props.onHandToAgent) : undefined}
      onDeleted={props.owner ? () => window.location.assign('/') : undefined} />
  </>;
}
