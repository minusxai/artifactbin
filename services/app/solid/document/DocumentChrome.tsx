/* @jsxImportSource solid-js */
/**
 * THE DOCUMENT PAGE'S BAR — the app's one bar (solid/components/PageChrome) with what a document adds to it:
 *
 *  - the BYLINE in place of the crumbs: the author's face and `@handle` (their profile), the follow pill, the
 *    document's title, the Join/Joined/Pending pill, and an
 *    archived version's one fixed line;
 *  - the RAIL beside the star: like and comment (with their counts), fork, install and share — the reader's
 *    own actions only while reading the head (archived versions act on nothing here);
 *  - the controls panel ("Artifact controls"), whose rows the page supplies.
 *
 * The document itself is not here: it is the frame under this bar, on its own origin (lib/serving/document-frame).
 */
import { createSignal, lazy, Show, Suspense, type Accessor, type JSX } from 'solid-js';
import Heart from 'lucide-solid/icons/heart';
import GitFork from 'lucide-solid/icons/git-fork';
import Download from 'lucide-solid/icons/download';
import Ellipsis from 'lucide-solid/icons/ellipsis';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import { loginHref } from '@/lib/http/login-href';
import { artifactAppPath } from '@/lib/serving/artifact-pwa';
import type { Visibility } from '@artifactbin/contracts';
import { PageChrome, type Panel } from '../components/PageChrome';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
// Compact-only actions must not make the wide reader import menu positioning and its UI chunk.
const SharingGlyph = lazy(() => import('./DocumentSharingGlyph').then(module => ({ default: module.DocumentSharingGlyph })));
const CompactMenu = lazy(() => import('./DocumentCompactMenu').then(module => ({ default: module.DocumentCompactMenu })));
import { DocumentTitle } from '../components/PageBar';
import { DocumentCommentAction } from './DocumentBarActions';
import { Avatar } from '../ui/Avatar';
import { sendReaction } from './reactions';

/** The one line an archived render's bar carries. */
const archivedBanner = (version: number, head: number): string => `Version ${version} of ${head} · read-only`;

export interface DocumentChromeProps {
  id: string;
  title: Accessor<string>;
  author: { username: string | null; id?: string | null; image?: string | null } | null;
  follow?: { userId: string; following: boolean; count: number } | null;
  like: { liked: boolean; count: number };
  /** The reader holds an account session (a like or a follow needs one). */
  signedIn: Accessor<boolean>;
  comments: Accessor<number>;
  archived?: { version: number; head: number } | null;
  canFork: boolean;
  /** A local shell has no remote actions until its scoped connection is approved. */
  remoteAvailable?: boolean;
  owner: boolean;
  install?: boolean;
  visibility?: Visibility;
  hasInvitedUsers?: boolean;
  membership?: 'join' | 'pending' | 'joined';
  panel: Accessor<Panel>;
  setPanel: (next: Panel) => void;
  mode: Accessor<'light' | 'dark'>;
  onMode: (next: 'light' | 'dark') => void;
  onComment: () => void;
  onFork: () => void;
  onShare: () => void;
  onMembership: () => void;
  controls: (close: () => void) => JSX.Element;
}


export function DocumentChrome(props: DocumentChromeProps): JSX.Element {
  const [like, setLike] = createSignal(props.like);
  const [follow, setFollow] = createSignal(props.follow ?? null);
  const reading = () => !props.archived && props.remoteAvailable !== false;
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
      <a href={`/@${handle()}`} aria-label={`View @${handle()}'s profile`} class="flex min-w-0 items-center gap-1.5 text-muted no-underline hover:text-accent">
        <Show when={props.author?.id}>{(authorId) => <Avatar image={props.author?.image ?? null} initial={handle()} userId={authorId()} size={20} />}</Show><span class="truncate">@{handle()}</span>
      </a>
      <Show when={follow()}>{(state) => (
        <Button variant="secondary" size="sm" aria-label={`${state().following ? 'Unfollow' : 'Follow'} @${handle()}`} aria-pressed={state().following} onClick={() => void toggleFollow()}>
          {state().following ? 'following' : 'follow'}
        </Button>
      )}</Show>
    </>}</Show>
    <ChevronRight size={14} class="shrink-0 text-faint" aria-hidden="true" />
    <DocumentTitle title={props.title()} />
    <Show when={!props.archived && props.membership}>
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
        <Button variant="ghost" size="sm" icon class="relative min-w-9" aria-label={like().liked ? 'Unlike' : 'Like'} aria-pressed={like().liked} onClick={() => void toggleLike()}>
          <Heart size={18} stroke-width={1.5} fill={like().liked ? 'currentColor' : 'none'} />
          <Show when={like().count > 0}><span class="absolute -right-0.5 -top-0.5 rounded-full bg-accent px-1 font-mono text-micro leading-4 text-action-ink">{like().count}</span></Show>
        </Button>
      </Tooltip>
      <DocumentCommentAction count={props.comments()} onClick={props.onComment} />
      <Show when={props.canFork}>
        <span class="hidden sm:contents"><Tooltip content="Fork artifact"><Button variant="ghost" size="sm" icon aria-label="Fork artifact" onClick={() => props.onFork()}><GitFork size={18} stroke-width={1.5} /></Button></Tooltip></span>
      </Show>
      <Show when={props.install}>
        <span class="hidden sm:contents"><Tooltip content="Install app"><Button variant="ghost" size="sm" icon href={`${artifactAppPath(props.id)}?install=1`} aria-label="Install app"><Download size={18} stroke-width={1.5} /></Button></Tooltip></span>
      </Show>
    </Show>
    <Show when={props.owner && !props.archived}>
      <Tooltip content="Share">
        <Button variant="secondary" size="sm" aria-label="Share" onClick={() => props.onShare()}>
          <Suspense fallback={<span aria-hidden="true" style={{width:'18px',height:'18px'}} />}><SharingGlyph visibility={props.visibility ?? 'private'} invited={props.hasInvitedUsers ?? false} /></Suspense><span class="hidden sm:inline">Share</span>
        </Button>
      </Tooltip>
    </Show>
  </>;

  const compactActions = () => <>
    <Show when={reading()}><DocumentCommentAction count={props.comments()} onClick={props.onComment} /></Show>
    <Show when={props.remoteAvailable !== false}><Suspense fallback={<Button variant="ghost" size="bar" icon disabled aria-label="Loading artifact actions"><Ellipsis size={20} stroke-width={1.5} /></Button>}><CompactMenu page={props} like={like} follow={follow} onLike={toggleLike} onFollow={toggleFollow} /></Suspense></Show>
  </>;

  return <PageChrome compactContext={<Show when={props.archived}>{at =>
    <span class="shrink-0 font-mono text-micro text-muted" aria-label={archivedBanner(at().version, at().head)}>v{at().version}</span>}</Show>} compactActions={compactActions} label="Artifact controls" title={props.title()} byline={byline} actions={actions} controls={props.controls}
    panel={props.panel} setPanel={props.setPanel} mode={props.mode} onMode={props.onMode} star />;
}
