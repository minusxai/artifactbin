/**
 * THE READER'S CHROME — everything a top-level reader gets AROUND the served
 * document, as one HTML string the builder (lib/story/document) drops after
 * the story root. Pure and react-free: it compiles inside the server graph and
 * inlines like the chrome CSS does.
 *
 * Server-rendered SHOWN (`data-mx-reader-state="shown"`, no hidden class): the
 * visibility policy is the reader's own, so it belongs to the every-document
 * entry (lib/story-runtime/reader-chrome-actions), which hides it on a scroll
 * DOWN and reveals it again on a scroll UP, the way a phone's own bars behave.
 * A document that cannot scroll, and the end of one that can, keep it outright:
 * there is no gesture left that could.
 *
 * What it holds, in DOM order (every name here is pinned by
 * lib/story/__tests__/reader-chrome.test.ts and read by browser gates — rename
 * nothing):
 *
 *  1. the LOGO (`.mx-reader-home`, aria "Home"): a plain link to `/`;
 *  2. the RAIL: the github-star span, then like · comment
 *     (`data-mx-reader-action`), then fork, edit and share — each only where
 *     the caller asked for it — then two panel triggers: `controls` ("Open
 *     artifact controls": appearance, the sign-in door, fork, provenance) and
 *     `menu` ("Open menu": the app drawer). 44px targets with tiny mono labels;
 *     The `menu` trigger draws the signed-in reader's FACE (`viewer`) in place
 *     of the profile glyph, and an accent ring rather than the X while open;
 *  3. the BYLINE: the artifactbin home crumb, the author's face (when the
 *     author is an account) and `@handle` (their profile), the title, and the
 *     follow pill;
 *  4. the share toast and the copy fallback field;
 *  5. the scrim and the two panels.
 *
 * Like, comment and follow each carry the DOOR the route resolved
 * (`data-mx-href`): top-level the entry navigates to it, and a framed copy asks
 * its page to act and repaints from the answer. A rail rendered without
 * `reactions` has no door and only logs the intent. There is no credits footer:
 * the author is the byline, the host is the logo, and provenance lives in the
 * settings panel.
 *
 * A framed copy (the owner's shell) hides all of it by CSS (`:root.mx-framed`)
 * — the parent supplies its own chrome — and a capture render never asks for
 * it at all.
 */

import { visibilityIconPaths, sharingIconFor } from '@/lib/visibility-icons';
import type { Visibility } from '@/lib/artifacts';
import { REPO_URL } from '@/lib/repo';
import { GITHUB_MARK_PATH, GITHUB_MARK_VIEWBOX } from '@/lib/github-mark';
import { githubStarMarkup } from '@/lib/github-star';
import { personFaceBackground, personInitial } from '@/lib/person-face';

/** The login door, when a link grants more than the anonymous ceiling lets a guest use. */
interface ReaderSignIn {
  unlocks: 'commenter' | 'editor';
  callbackUrl: string;
}

/** The fork ASK: an anchor the shell performs, since an opaque document cannot POST. */
interface ReaderFork {
  href: string;
}

/**
 * PROVENANCE, resolved by the route per render and never written into the
 * markup. A public source carries an href; anything that is not public —
 * unlisted, private, deleted — arrives with `href: null` and a label that
 * says only that there WAS a source, so the line can be neither an existence
 * oracle nor a listing surface.
 */
export interface ReaderForkedFrom {
  label: string;
  href: string | null;
}

/**
 * WHAT THE RAIL SAYS ABOUT THIS DOCUMENT AND ITS AUTHOR, and where each ask
 * goes. Counts are everyone's; `liked`/`following` are this viewer's; each
 * `href` is the door a TOP-LEVEL document navigates to (a framed copy asks its
 * page instead). `follow` is null when there is nobody to follow — an
 * anonymous document, or the author reading their own.
 */
export interface ReaderReactions {
  like: { count: number; liked: boolean; href: string };
  follow: { following: boolean; count: number; href: string } | null;
  /** Unresolved threads, and the door. */
  comment: { count: number; href: string };
}

/** A person the rail draws: the account id (the colour), a name (the letter) and their picture's address. */
export interface ReaderPerson {
  id: string;
  name: string;
  image: string | null;
}

export interface ReaderChromeInput {
  /** SPA controls are mounted separately in TrustedUi; raw documents retain their own panels. */
  panels?: boolean;
  /** Dataset mutation membership; omitted on read-only documents. */
  membership?: 'join' | 'pending' | 'joined';
  /** Only the owner gets the prominent sharing entry point. */
  share?: boolean;
  visibility?: Visibility;
  hasInvitedUsers?: boolean;
  /** Stamped on the root (`data-mx-artifact-id`) so the like/comment log can name the document. Omitted when null. */
  artifactId: string | null;
  /** The document's title, for the byline and the share sheet. Omitted when null. */
  title: string | null;
  /**
   * The author's handle (null on an anonymous document: no author mark at all)
   * and where the copy came from. `id` and `image` draw their face before the
   * handle; without an id there is no face.
   */
  author: { username: string | null; id?: string | null; image?: string | null; forkedFrom?: ReaderForkedFrom | null } | null;
  /**
   * WHO IS READING — the signed-in account, drawn on the `menu` trigger in
   * place of the profile glyph. Null or absent (a guest, a signed-out reader, a
   * capture): the glyph, byte for byte.
   */
  viewer?: ReaderPerson | null;
  signIn?: ReaderSignIn | null;
  fork?: ReaderFork | null;
  forkBusy?: boolean;
  /** A "Sign in" entry in the profile menu, for a reader with no session. Null when signed in. */
  login?: { href: string } | null;
  /** This viewer may WRITE (the owner's or an editor's framed copy): the rail offers Edit. */
  edit?: boolean;
  /** The owner sees the artifact title beside the handle as a breadcrumb. */
  ownerBreadcrumb?: boolean;
  /** Counts, the viewer's own state, and the doors. Absent: the rail is inert (tests, previews). */
  reactions?: ReaderReactions | null;
  /**
   * THIS IS AN OLDER VERSION (`?version=N` — lib/archived-version): the rail
   * draws ONE fixed line, "Version N of M · read-only", and NONE of the
   * actions. Like, comment and fork all act on the artifact as it is now, and
   * an inert copy of them beside bytes that are no longer the document is worse
   * than their absence — a reader presses comment and anchors a thread to a
   * paragraph nobody else can see.
   */
  archived?: { version: number; head: number } | null;
}

/**
 * The ONE line an archived render carries, in one place — the served
 * document's rail and the app page's own chrome draw the same words, and a
 * reader who follows `?version=2` from one to the other must not be told two
 * different things about what they are looking at.
 */
export const archivedBanner = (version: number, head: number): string => `Version ${version} of ${head} · read-only`;

/** The class the visibility policy toggles; the root is rendered with it. */
export const READER_CHROME_HIDDEN_CLASS = 'mx-reader-chrome--hidden';

/** `data-mx-reader-state` values: what the policy last decided. */
export type ReaderChromeState = 'hidden' | 'shown';

/**
 * THE ONE ESCAPE RULE the served document is assembled with — shared with
 * lib/story/document rather than copied, so the chrome and the head can never
 * disagree about what a hostile handle or title turns into. `<`, `>`, `&` and
 * `"` cover both positions this module writes into (text and a quoted
 * attribute); nothing here is ever written unquoted.
 */
export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/*
 * The glyphs, inline. Lucide's shapes at lucide's stroke, drawn here rather
 * than imported: this string is assembled on the SERVER for a document that
 * may ship no JavaScript at all, and the reader's chrome must not be the
 * reason a prose page downloads an icon set (lib/story/icon-glyphs makes the
 * same trade for the document's own <Icon>).
 */
const ICON = (paths: string, size = 20): string =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor"`
  + ` stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const ICON_CHEVRON = ICON('<path d="m9 18 6-6-6-6"/>', 14);
const ICON_GITHUB = `<svg viewBox="${GITHUB_MARK_VIEWBOX}" preserveAspectRatio="xMidYMid meet" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="${GITHUB_MARK_PATH}"/></svg>`;
const ICON_HEART = ICON('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21.2l7.7-7.7 1.1-1.1a5.5 5.5 0 0 0 0-7.8z"/>');
const ICON_COMMENT = ICON('<path d="M21 11.5a8.4 8.4 0 0 1-9 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 4 12a8.4 8.4 0 0 1 8.5-9 8.4 8.4 0 0 1 8.5 8.5z"/>');
const ICON_PENCIL = ICON('<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>');
// `mx-rc-open`, like the sliders: the glyph a trigger swaps for the X while its panel is open.
const ICON_PROFILE = '<svg class="mx-rc-open" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M6.2 19a6 6 0 0 1 11.6 0"/></svg>';
const ICON_SLIDERS = `<svg class="mx-rc-open" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>`;
const ICON_X = '<svg class="mx-rc-close" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12"/></svg>';
const ICON_SUN = ICON('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>', 15);
const ICON_MOON = ICON('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>', 15);
const ICON_FORK = ICON('<circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/><path d="M12 12v3"/>');

/** The tiny mono word under (phone) or beside (desktop) every target. */
const label = (text: string): string =>
  `<span class="mx-reader-label" data-mobile-label>${text}</span>`;

/**
 * A rail ACTION — like, comment, share. A button, never a link: where it leads
 * is `data-mx-href`, decided by the route and acted on by the entry, so a
 * framed copy can hand the press to its page instead of navigating itself.
 */
const action = (name: 'like' | 'comment' | 'share' | 'edit' | 'fork', aria: string, icon: string, extra = '', inner = ''): string =>
  `<button type="button" class="mx-reader-action" data-mx-reader-action="${name}" aria-label="${aria}" data-mx-tip="${aria}"${extra}>`
  + `${icon}${inner}${label(name)}</button>`;

/**
 * A PANEL trigger. The open/close glyph pair and the aria-label flip are the
 * contract the entry module and half a dozen browser gates already speak, so
 * both survived the move from the corner buttons to the rail unchanged.
 */
const trigger = (name: 'controls' | 'menu', aria: string, icon: string, text: string, tip: string): string =>
  `<button type="button" class="mx-reader-trigger" data-mx-reader-trigger="${name}" aria-label="${aria}" aria-expanded="false" data-mx-tip="${tip}">`
  + `${icon}${ICON_X}${label(text)}</button>`;

/**
 * A PERSON'S FACE, as a string — the rail's twin of components/Avatar, on the
 * same rules (lib/person-face): the initial on the account's colour is ALWAYS
 * underneath, and the picture, when there is one, is painted over it, so an
 * address that stops answering reveals the letter. Decorative: whatever holds
 * it carries the name. The background rides a `style` attribute, which the
 * document's CSP admits (`style-src 'unsafe-inline'`, lib/story/markup-csp).
 */
const face = (person: { id: string; name: string; image: string | null }, variant: 'viewer' | 'author'): string =>
  `<span class="mx-reader-face mx-reader-face--${variant}" aria-hidden="true">`
  + `<span class="mx-reader-face-initial" style="background:${escapeHtml(personFaceBackground(person.id))}">${escapeHtml(personInitial(person.name))}</span>`
  + (person.image ? `<img src="${escapeHtml(person.image)}" alt="" aria-hidden="true" decoding="async">` : '')
  + '</span>';

/**
 * The `menu` trigger with the reader's face on it. The attributes are the
 * glyph trigger's, unchanged — the entry flips the same aria-label — but there
 * is no X: a face stays a face while its menu is open, and the CSS rings it.
 */
const faceTrigger = (viewer: ReaderPerson): string =>
  '<button type="button" class="mx-reader-trigger" data-mx-reader-trigger="menu" aria-label="Open menu" aria-expanded="false" data-mx-tip="Profile">'
  + `${face(viewer, 'viewer')}${label('profile')}</button>`;

const SIGN_IN_LABEL: Record<'commenter' | 'editor', string> = {
  commenter: 'log in to comment',
  editor: 'log in to edit',
};

/** The login door — an anchor and nothing else; an opaque document cannot act. */
const renderSignIn = (signIn: ReaderSignIn): string =>
  `<a class="mx-reader-signin" data-mx-signin href="/login?callbackUrl=${escapeHtml(encodeURIComponent(signIn.callbackUrl))}"`
  + ` target="_top" aria-label="${escapeHtml(SIGN_IN_LABEL[signIn.unlocks])}">${escapeHtml(SIGN_IN_LABEL[signIn.unlocks])}</a>`;

/** "make this mine" — the ASK; the shell on the other side performs the POST. */
const renderFork = (fork: ReaderFork): string =>
  `<a class="mx-reader-action" data-mx-fork href="${escapeHtml(fork.href)}"`
  + ` target="_top" aria-label="Fork artifact" data-mx-tip="Fork artifact">${ICON_FORK}${label('fork')}</a>`;

/**
 * PROVENANCE. Two shapes, and the second is the load-bearing one: with an href
 * it names and links the source; without one it says only that there WAS a
 * source, as plain text — "forked from a private document" has to read as one
 * sentence, and nothing in the DOM should mark where the name would have been.
 * The label is the ROUTE's, so unlisted, private and deleted arrive here
 * already indistinguishable.
 */
const renderForkedFrom = (forkedFrom: ReaderForkedFrom): string => {
  const text = escapeHtml(forkedFrom.label);
  const inner = forkedFrom.href
    ? `<a href="${escapeHtml(forkedFrom.href)}" target="_top" aria-label="Open the artifact this was forked from">${text}</a>`
    : text;
  return `<span class="mx-reader-forked" data-mx-forked-from>forked from ${inner}</span>`;
};

/**
 * Render the reader chrome. Every string that came from a row — the handle,
 * the title, the provenance label, the hrefs — is HTML-escaped on the way out.
 */
export function renderReaderChrome(input: ReaderChromeInput): string {
  const { artifactId, title, author, signIn = null, login = null, reactions = null, archived = null } = input;
  // An archived render has no doors at all — see ReaderChromeInput.archived.
  const fork = archived ? null : input.fork ?? null;
  const edit = !archived && (input.edit ?? false);
  const sharingIcon = sharingIconFor({ visibility: input.visibility ?? 'private', hasInvitedUsers: input.hasInvitedUsers ?? false });
  const username = author?.username ?? null;
  const viewer = input.viewer ?? null;
  // The author's face needs an account to take its colour from, and a handle
  // to sit beside.
  const authorFace = username && author?.id ? face({ id: author.id, name: username, image: author.image ?? null }, 'author') : '';
  const forkedFrom = author?.forkedFrom ?? null;
  const following = reactions?.follow?.following ?? false;
  const followAria = `${following ? 'Unfollow' : 'Follow'} @${escapeHtml(username ?? '')}`;

  const byline = `<div class="mx-reader-byline" data-mx-reader-byline${input.ownerBreadcrumb ? ' data-mx-owner-breadcrumb' : ''}>`
    + '<a class="mx-reader-brand-crumb" href="/" target="_top">artifactbin</a>'
    + (username ? `<span class="mx-reader-chevron" aria-hidden="true">${ICON_CHEVRON}</span>` : '')
    // The author's face rides INSIDE the handle's link, before the `@`: one
    // target, and a phone byline that wraps can never strand the face on the
    // line above its handle. Decorative — the link's aria-label is its name.
    + (username ? '<span class="mx-reader-author-group">' : '')
    + (username
      ? `<a class="mx-reader-author" href="/@${escapeHtml(username)}" target="_top"`
        + ` aria-label="View @${escapeHtml(username)}'s profile">${authorFace}@${escapeHtml(username)}</a>`
      : '')
    // FOLLOW rides right beside the handle it follows, and only when there is
    // one: an anonymous document has nobody to follow.
    + (username && (!reactions || reactions.follow)
      ? `<button type="button" class="mx-reader-follow" data-mx-reader-action="follow" data-mx-author="${escapeHtml(username)}"`
        + ` aria-label="${followAria}" data-mx-tip="${followAria}"`
        + (reactions?.follow ? ` data-mx-following="${following}" data-mx-href="${escapeHtml(reactions.follow.href)}"` : '')
        + `>${following ? 'following' : 'follow'}</button>`
      : '')
    + (username ? '</span>' : '')
    + (title ? `<span class="mx-reader-chevron" aria-hidden="true">${ICON_CHEVRON}</span>` : '')
    + (title || (!archived && input.membership) ? '<span class="mx-reader-title-group">' : '')
    + (title ? `<span class="mx-reader-title">${escapeHtml(title)}</span>` : '')
    + (!archived && input.membership ? `<button type="button" class="mx-reader-membership" data-mx-reader-action="membership" aria-label="${input.membership === 'joined' ? 'Joined — view people' : input.membership === 'pending' ? 'Pending — view request' : 'Join artefact'}">${input.membership === 'joined' ? 'Joined' : input.membership === 'pending' ? 'Pending' : 'Join'}</button>` : '')
    + (title || (!archived && input.membership) ? '</span>' : '')
    + '</div>';

  // The heading appears when the panel has anything to say about THIS
  // document; each of the three arrives independently of the others.
  const aboutThis = signIn || fork || forkedFrom;

  return `<div class="mx-reader-chrome" data-mx-reader-chrome data-mx-reader-state="shown"`
    + `${artifactId ? ` data-mx-artifact-id="${escapeHtml(artifactId)}"` : ''}>`
    + '<a class="mx-reader-home" href="/" target="_top" aria-label="Home" data-mx-reader-logo data-mx-tip="Home">'
    + '<img src="/logo-128.png" alt=""></a>'
    + '<div class="mx-reader-rail" data-mx-reader-rail>'
    + `<span data-mx-github-star class="mx-reader-github">${githubStarMarkup()}</span>`
    + (archived ? '' : action(
      'like',
      reactions?.like.liked ? 'Unlike' : 'Like',
      ICON_HEART,
      reactions ? ` data-mx-liked="${reactions.like.liked}" data-mx-href="${escapeHtml(reactions.like.href)}"` : '',
      // The count is everyone's; empty (and so hidden) at zero. The entry
      // rewrites it when the page answers a press.
      `<span class="mx-reader-count" data-mx-reader-count="like">${reactions && reactions.like.count > 0 ? reactions.like.count : ''}</span>`,
    ))
    + (archived ? '' : action(
      'comment',
      'Comment',
      ICON_COMMENT,
      reactions ? ` data-mx-href="${escapeHtml(reactions.comment.href)}"` : '',
      `<span class="mx-reader-count" data-mx-reader-count="comment">${reactions && reactions.comment.count > 0 ? reactions.comment.count : ''}</span>`,
    ))
    + (archived ? '' : input.panels === false ? action('fork', 'Fork artifact', ICON_FORK, input.forkBusy ? ' disabled aria-busy="true"' : '') : fork ? renderFork(fork) : '')
    + (edit ? action('edit', 'Edit', ICON_PENCIL) : '')
    + (input.share ? action('share', 'Share', `<span data-mx-visibility="${input.visibility ?? 'private'}" data-mx-sharing-icon="${sharingIcon}">${ICON(visibilityIconPaths(sharingIcon))}</span>`, '', '<span class="mx-reader-share-text">Share</span>') : '')
    + trigger('controls', 'Open artifact controls', ICON_SLIDERS, 'settings', 'Artifact settings')
    + (viewer ? faceTrigger(viewer) : trigger('menu', 'Open menu', ICON_PROFILE, 'profile', 'Profile'))
    + '</div>'
    + byline
    // WHICH VERSION THIS IS — fixed, never a control, and the only thing an
    // archived render adds to the rail.
    + (archived
      ? `<span class="mx-reader-archived" data-mx-archived-version="${archived.version}" data-mx-archived-head="${archived.head}">${escapeHtml(archivedBanner(archived.version, archived.head))}</span>`
      : '')
    + '<span class="mx-reader-toast" data-mx-reader-toast hidden>link copied</span>'
    + '<input class="mx-reader-copy" data-mx-reader-copy type="text" readonly tabindex="-1" aria-hidden="true">'
    + (input.panels === false ? '' : '<button type="button" class="mx-reader-scrim" data-mx-reader-scrim aria-label="Close page controls" hidden></button>'
    + '<nav class="mx-reader-panel mx-reader-panel--menu" data-mx-reader-panel="menu" aria-label="Menu" hidden>'
    + '<a class="mx-reader-brand" href="/" target="_top"><img src="/logo-128.png" alt="">artifactbin</a>'
    + (login ? `<a class="mx-reader-signin" data-mx-login href="${escapeHtml(login.href)}" target="_top" aria-label="Sign in">sign in</a>` : '')
    + '<a href="/" target="_top">Artifacts</a><a href="/account" target="_top">Account</a>'
    + '<a href="/docs-human" target="_top">Human Docs</a>'
    + `<a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">${ICON_GITHUB}Support artifactbin</a>`
    + '</nav>'
    + '<section class="mx-reader-panel mx-reader-panel--controls" data-mx-reader-panel="controls" aria-label="Artifact controls" hidden>'
    + '<h2>artifact controls</h2><h3>appearance</h3>'
    + '<div class="mx-reader-modes" role="group" aria-label="Color mode">'
    + `<button type="button" data-mx-mode-choice="light" aria-label="Light mode">${ICON_SUN}light</button>`
    + `<button type="button" data-mx-mode-choice="dark" aria-label="Dark mode">${ICON_MOON}dark</button>`
    + '</div>'
    + (aboutThis ? '<h3>this document</h3>' : '')
    + (signIn ? renderSignIn(signIn) : '')
    + (forkedFrom ? renderForkedFrom(forkedFrom) : '')
    + '</section>') + '</div>';
}
