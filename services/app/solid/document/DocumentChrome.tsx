/* @jsxImportSource solid-js */
/**
 * THE DOCUMENT PAGE'S BAR — the app's one bar (solid/components/PageChrome) with what a document adds to it:
 *
 *  - the BYLINE in place of the crumbs: the author's face and `@handle` (their profile), the follow pill, the
 *    document's title (the title editor's slot while editing, `titleHost`), the Join/Joined/Pending pill, and an
 *    archived version's one fixed line;
 *  - the RAIL beside the star: like and comment (with their counts), fork, install, edit and share — the reader's
 *    own actions only while reading the head (an archived version and an edit session act on nothing here);
 *  - the controls panel ("Artifact controls"), whose rows the page supplies.
 *
 * The document itself is not here: it is the frame under this bar, on its own origin (lib/serving/document-frame).
 */
import { createSignal, Show, type Accessor, type JSX } from 'solid-js';
import Heart from 'lucide-solid/icons/heart';
import GitFork from 'lucide-solid/icons/git-fork';
import Download from 'lucide-solid/icons/download';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import { loginHref } from '@/lib/http/login-href';
import { artifactAppPath } from '@/lib/serving/artifact-pwa';
import { sharingIconFor, VISIBILITY_ICON_NODES } from '@/lib/workspace/visibility-icons';
import type { Visibility } from '@artifactbin/contracts';
import { PageChrome, type Panel } from '../components/PageChrome';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { DocumentTitle } from '../components/PageBar';
import { DocumentCommentAction, DocumentEditAction } from './DocumentBarActions';
import { Avatar } from '../ui/Avatar';
import { sendReaction } from './reactions';

/** The one line an archived render's bar carries. */
const archivedBanner = (version: number, head: number): string => `Version ${version} of ${head} · read-only`;

interface DocumentChromeProps {
  id: string;
  title: Accessor<string>;
  author: { username: string | null; id?: string | null; image?: string | null } | null;
  follow?: { userId: string; following: boolean; count: number } | null;
  like: { liked: boolean; count: number };
  /** The reader holds an account session (a like or a follow needs one). */
  signedIn: Accessor<boolean>;
  comments: Accessor<number>;
  archived?: { version: number; head: number } | null;
  editing?: Accessor<boolean>;
  canEdit: boolean;
  canFork: boolean;
  owner: boolean;
  install?: boolean;
  visibility?: Visibility;
  hasInvitedUsers?: boolean;
  membership?: 'join' | 'pending' | 'joined';
  /** While true, the title is the editor's slot (`titleHost`) rather than text. */
  titleSlot?: Accessor<boolean>;
  titleHost?: (element: HTMLElement | null) => void;
  panel: Accessor<Panel>;
  setPanel: (next: Panel) => void;
  mode: Accessor<'light' | 'dark'>;
  onMode: (next: 'light' | 'dark') => void;
  onComment: () => void;
  onFork: () => void;
  onShare: () => void;
  onEdit: () => void;
  onMembership: () => void;
  controls: (close: () => void) => JSX.Element;
}

/** The Install link is a link (it navigates to the app), drawn like the rail's ghost `sm` buttons. */
const RAIL_LINK = 'flex h-control-sm min-w-control-sm items-center justify-center gap-1 rounded-control px-2.5 font-mono text-xs text-muted no-underline transition-colors hover:bg-raised hover:text-fg';

function SharingGlyph(props: { visibility: Visibility; invited: boolean }): JSX.Element {
  const nodes = () => VISIBILITY_ICON_NODES[sharingIconFor({ visibility: props.visibility, hasInvitedUsers: props.invited })];
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    innerHTML={nodes().map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([name]) => name !== 'key').map(([name, value]) => `${name}="${value}"`).join(' ')}/>`).join('')} />;
}

export function DocumentChrome(props: DocumentChromeProps): JSX.Element {
  const [like, setLike] = createSignal(props.like);
  const [follow, setFollow] = createSignal(props.follow ?? null);
  const editing = () => props.editing?.() ?? false;
  const reading = () => !props.archived && !editing();
  const toLogin = (intent: 'like' | 'follow') => window.location.assign(loginHref(window.location, intent));

  const toggleLike = async () => {
    if (!props.signedIn()) { toLogin('like'); return; }
    const answer = await sendReaction<{ liked: boolean; count: number }>(`/api/my/artifacts/${encodeURIComponent(props.id)}/like`, like().liked, 'like');
    if (answer) setLike(answer);
  };
  const toggleFollow = async () => {
    const current = follow();
    if (!current) return;
    if (!props.signedIn()) { toLogin('follow'); return; }
    const answer = await sendReaction<{ following: boolean; count: number }>(`/api/users/${encodeURIComponent(current.userId)}/follow`, current.following, 'follow');
    if (answer) setFollow({ ...current, following: answer.following, count: answer.count });
  };

  const username = () => props.author?.username ?? null;
  const membershipLabel = () => (props.membership === 'joined' ? 'Joined — view people' : props.membership === 'pending' ? 'Pending — view request' : 'Join artifact');
  const byline = <>
    <Show when={username()}>{(handle) => <>
      <ChevronRight size={14} class="shrink-0 text-faint" aria-hidden="true" />
      <a href={`/@${handle()}`} aria-label={`View @${handle()}'s profile`} class="flex shrink-0 items-center gap-1.5 text-muted no-underline hover:text-accent">
        <Show when={props.author?.id}>{(authorId) => <Avatar image={props.author?.image ?? null} initial={handle()} userId={authorId()} size={20} />}</Show>@{handle()}
      </a>
      <Show when={follow()}>{(state) => (
        <Button variant="secondary" size="sm" aria-label={`${state().following ? 'Unfollow' : 'Follow'} @${handle()}`} aria-pressed={state().following} onClick={() => void toggleFollow()}>
          {state().following ? 'following' : 'follow'}
        </Button>
      )}</Show>
    </>}</Show>
    <ChevronRight size={14} class="shrink-0 text-faint" aria-hidden="true" />
    <Show when={props.titleSlot?.()} fallback={<DocumentTitle title={props.title()} />}>
      <span class="min-w-0 flex-1" ref={(element) => props.titleHost?.(element)} />
    </Show>
    <Show when={!props.archived && !editing() && props.membership}>
      <Button variant="secondary" size="sm" aria-label={membershipLabel()} onClick={() => props.onMembership()}>
        {props.membership === 'joined' ? 'Joined' : props.membership === 'pending' ? 'Pending' : 'Join'}
      </Button>
    </Show>
    <Show when={props.archived}>{(at) => (
      <span class="shrink-0 truncate text-muted" data-mx-archived-version={at().version} data-mx-archived-head={at().head}>{archivedBanner(at().version, at().head)}</span>
    )}</Show>
  </>;

  const actions = <>
    <Show when={reading()}>
      <Tooltip content={like().liked ? 'Unlike' : 'Like'}>
        <Button variant="ghost" size="sm" {...(like().count > 0 ? {} : { icon: true as const })} aria-label={like().liked ? 'Unlike' : 'Like'} aria-pressed={like().liked} onClick={() => void toggleLike()}>
          <Heart size={18} stroke-width={1.5} fill={like().liked ? 'currentColor' : 'none'} />
          <Show when={like().count > 0}><span>{like().count}</span></Show>
        </Button>
      </Tooltip>
      <DocumentCommentAction count={props.comments()} onClick={props.onComment} />
      <Show when={props.canFork}>
        <span class="hidden sm:contents"><Tooltip content="Fork artifact"><Button variant="ghost" size="sm" icon aria-label="Fork artifact" onClick={() => props.onFork()}><GitFork size={18} stroke-width={1.5} /></Button></Tooltip></span>
      </Show>
      <Show when={props.install}>
        <Tooltip content="Install app"><a class={`${RAIL_LINK} hidden sm:flex`} href={`${artifactAppPath(props.id)}?install=1`} aria-label="Install app"><Download size={18} stroke-width={1.5} /></a></Tooltip>
      </Show>
    </Show>
    <Show when={props.canEdit && !props.archived}>
      <DocumentEditAction editing={editing()} onClick={props.onEdit} />
    </Show>
    <Show when={props.owner && !props.archived}>
      <Tooltip content="Share">
        <Button variant="secondary" size="sm" aria-label="Share" onClick={() => props.onShare()}>
          <SharingGlyph visibility={props.visibility ?? 'private'} invited={props.hasInvitedUsers ?? false} /><span class="hidden sm:inline">Share</span>
        </Button>
      </Tooltip>
    </Show>
  </>;

  return <PageChrome label="Artifact controls" title={props.title()} byline={byline} actions={actions} controls={props.controls}
    panel={props.panel} setPanel={props.setPanel} mode={props.mode} onMode={props.onMode} star={!editing()} />;
}
