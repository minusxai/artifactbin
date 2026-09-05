/**
 * THE READER'S CHROME — everything a top-level reader gets AROUND the served
 * document, as one HTML string the builder (lib/story/document) drops after
 * the story root. Pure and react-free: it compiles inside the server graph and
 * inlines like the chrome CSS does.
 *
 * Server-rendered HIDDEN. On load the reader sees nothing but the artifact —
 * the document as its author intended — and the every-document entry
 * (lib/story-runtime/reader-chrome-actions) reveals it on a scroll UP and
 * hides it again on a scroll DOWN, the way a phone's own bars behave. A
 * document that cannot scroll, and the end of one that can, show it outright:
 * there is no gesture left that could.
 *
 * What it holds, in DOM order (every name here is pinned by
 * lib/story/__tests__/reader-chrome.test.ts and read by browser gates — rename
 * nothing):
 *
 *  1. the LOGO (`.mx-reader-home`, aria "Home"): a plain link to `/`, and
 *     the only "hosted on artifactbin" mark left;
 *  2. the RAIL: like · comment · share (`data-mx-reader-action`), then the two
 *     panel triggers exactly as they always were — `controls` ("Open artifact
 *     controls": appearance, the sign-in door, fork, provenance) and `menu`
 *     ("Open menu": the app drawer) — 44px targets with tiny mono labels;
 *  3. the BYLINE: the author's `@handle` (their profile), the title, and the
 *     ⊕ create link;
 *  4. the share toast and the copy fallback field;
 *  5. the scrim and the two panels.
 *
 * Like and comment are UI ONLY for now: the entry logs them to the console
 * with the artifact id, and nothing is fetched. Share is real. The credits
 * footer this replaces ("made with ♥ by … · hosted on artifactbin") is
 * retired: the author is the byline, the host is the logo, and provenance
 * lives in the settings panel.
 *
 * A framed copy (the owner's shell) hides all of it by CSS (`:root.mx-framed`)
 * — the parent supplies its own chrome — and a capture render never asks for
 * it at all.
 */

import { REPO_URL } from '@/lib/repo';

/** The login door, when a link grants more than the anonymous ceiling lets a guest use. */
export interface ReaderSignIn {
  unlocks: 'commenter' | 'editor';
  callbackUrl: string;
}

/** The fork ASK: an anchor the shell performs, since an opaque document cannot POST. */
export interface ReaderFork {
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

export interface ReaderChromeInput {
  /** Stamped on the root (`data-mx-artifact-id`) so the like/comment log can name the document. Omitted when null. */
  artifactId: string | null;
  /** The document's title, for the byline and the share sheet. Omitted when null. */
  title: string | null;
  /** The author's handle (null on an anonymous document: no author mark at all) and where the copy came from. */
  author: { username: string | null; forkedFrom?: ReaderForkedFrom | null } | null;
  signIn?: ReaderSignIn | null;
  fork?: ReaderFork | null;
  /** A "Sign in" entry in the profile menu, for a reader with no session. Null when signed in. */
  login?: { href: string } | null;
  /** This viewer may WRITE (the owner's or an editor's framed copy): the rail offers Edit. */
  edit?: boolean;
  /** The owner sees the artifact title beside the handle as a breadcrumb. */
  ownerBreadcrumb?: boolean;
  /** Counts, the viewer's own state, and the doors. Absent: the rail is inert (tests, previews). */
  reactions?: ReaderReactions | null;
}

/** The class the visibility policy toggles; the root is rendered with it. */
export const READER_CHROME_HIDDEN_CLASS = 'mx-reader-chrome--hidden';

/** `data-mx-reader-state` values: what the policy last decided. */
export type ReaderChromeState = 'hidden' | 'shown';

/**
 * Render the reader chrome. Every string that came from a row — the handle,
 * the title, the provenance label, the hrefs — is HTML-escaped on the way out.
 */
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
  + ` stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const ICON_STAR = ICON('<path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2L12 17.3l-5.7 3 1.1-6.2L2.9 9.6l6.3-.9z"/>', 13);
const ICON_CHEVRON = ICON('<path d="m9 18 6-6-6-6"/>', 14);
const ICON_GITHUB = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.575.106.785-.25.785-.554 0-.273-.01-.997-.015-1.957-3.196.695-3.87-1.54-3.87-1.54-.523-1.33-1.277-1.684-1.277-1.684-1.043-.714.08-.699.08-.699 1.153.081 1.76 1.184 1.76 1.184 1.026 1.757 2.69 1.25 3.345.956.105-.743.401-1.25.73-1.538-2.552-.29-5.235-1.276-5.235-5.68 0-1.255.448-2.281 1.183-3.086-.119-.291-.513-1.46.112-3.044 0 0 .965-.309 3.163 1.179a10.98 10.98 0 0 1 2.88-.388c.977.005 1.961.132 2.88.388 2.196-1.488 3.16-1.179 3.16-1.179.626 1.584.232 2.753.114 3.044.737.805 1.181 1.831 1.181 3.086 0 4.415-2.687 5.386-5.247 5.671.412.355.78 1.056.78 2.129 0 1.537-.014 2.776-.014 3.154 0 .307.207.665.79.552A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5z"/></svg>';
const ICON_HEART = ICON('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21.2l7.7-7.7 1.1-1.1a5.5 5.5 0 0 0 0-7.8z"/>');
const ICON_COMMENT = ICON('<path d="M21 11.5a8.4 8.4 0 0 1-9 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 4 12a8.4 8.4 0 0 1 8.5-9 8.4 8.4 0 0 1 8.5 8.5z"/>');
const ICON_SEND = ICON('<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>');
const ICON_PENCIL = ICON('<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>');
// `mx-rc-open`, like the sliders: the glyph a trigger swaps for the X while its panel is open.
const ICON_PROFILE = '<svg class="mx-rc-open" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M6.2 19a6 6 0 0 1 11.6 0"/></svg>';
const ICON_SLIDERS = `<svg class="mx-rc-open" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>`;
const ICON_X = '<svg class="mx-rc-close" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12"/></svg>';
const ICON_SUN = ICON('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>', 15);
const ICON_MOON = ICON('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>', 15);
const ICON_FORK = ICON('<circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/><path d="M12 12v3"/>', 15);

/** The tiny mono word under (phone) or beside (desktop) every target. */
const label = (text: string): string =>
  `<span class="mx-reader-label" data-mobile-label>${text}</span>`;

/**
 * A rail ACTION — like, comment, share. A button, never a link: none of the
 * three navigates, and two of them do not even reach the network yet.
 */
const action = (name: 'like' | 'comment' | 'share' | 'edit', aria: string, icon: string, extra = '', inner = ''): string =>
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
  `<a class="mx-reader-signin" data-mx-fork href="${escapeHtml(fork.href)}"`
  + ` target="_top" aria-label="Fork artifact">${ICON_FORK}fork</a>`;

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
  const { artifactId, title, author, signIn = null, fork = null, login = null, edit = false, reactions = null } = input;
  const username = author?.username ?? null;
  const forkedFrom = author?.forkedFrom ?? null;
  const following = reactions?.follow?.following ?? false;
  const followAria = `${following ? 'Unfollow' : 'Follow'} @${escapeHtml(username ?? '')}`;

  const byline = `<div class="mx-reader-byline" data-mx-reader-byline${input.ownerBreadcrumb ? ' data-mx-owner-breadcrumb' : ''}>`
    + (username
      ? `<a class="mx-reader-author" href="/@${escapeHtml(username)}" target="_top"`
        + ` aria-label="View @${escapeHtml(username)}'s profile">@${escapeHtml(username)}</a>`
      : '')
    // FOLLOW rides right beside the handle it follows, and only when there is
    // one: an anonymous document has nobody to follow. UI only for now — the
    // entry logs it with the author, the way like and comment log.
    + (input.ownerBreadcrumb && username && title ? `<span class="mx-reader-chevron" aria-hidden="true">${ICON_CHEVRON}</span>` : '')
    + (title ? `<span class="mx-reader-title">${escapeHtml(title)}</span>` : '')
    + (username && (!reactions || reactions.follow)
      ? `<button type="button" class="mx-reader-follow" data-mx-reader-action="follow" data-mx-author="${escapeHtml(username)}"`
        + ` aria-label="${followAria}" data-mx-tip="${followAria}"`
        + (reactions?.follow ? ` data-mx-following="${following}" data-mx-href="${escapeHtml(reactions.follow.href)}"` : '')
        + `>${following ? 'following' : 'follow'}</button>`
      : '')
    + '</div>';

  // The heading appears when the panel has anything to say about THIS
  // document; each of the three arrives independently of the others.
  const aboutThis = signIn || fork || forkedFrom;

  return `<div class="mx-reader-chrome ${READER_CHROME_HIDDEN_CLASS}" data-mx-reader-chrome data-mx-reader-state="hidden"`
    + `${artifactId ? ` data-mx-artifact-id="${escapeHtml(artifactId)}"` : ''}>`
    + '<a class="mx-reader-home" href="/" target="_top" aria-label="Home" data-mx-reader-logo data-mx-tip="Home">'
    + '<img src="/logo-128.png" alt=""></a>'
    + `<a class="mx-reader-github" href="${REPO_URL}" target="_blank" rel="noopener noreferrer" aria-label="Star artifactbin on GitHub (opens in a new tab)">${ICON_GITHUB}<span>STAR</span>${ICON_STAR}</a>`
    + '<div class="mx-reader-rail" data-mx-reader-rail>'
    + action(
      'like',
      reactions?.like.liked ? 'Unlike' : 'Like',
      ICON_HEART,
      reactions ? ` data-mx-liked="${reactions.like.liked}" data-mx-href="${escapeHtml(reactions.like.href)}"` : '',
      // The count is everyone's; empty (and so hidden) at zero. The entry
      // rewrites it when the page answers a press.
      `<span class="mx-reader-count" data-mx-reader-count="like">${reactions && reactions.like.count > 0 ? reactions.like.count : ''}</span>`,
    )
    + action(
      'comment',
      'Comment',
      ICON_COMMENT,
      reactions ? ` data-mx-href="${escapeHtml(reactions.comment.href)}"` : '',
      `<span class="mx-reader-count" data-mx-reader-count="comment">${reactions && reactions.comment.count > 0 ? reactions.comment.count : ''}</span>`,
    )
    + action('share', 'Share', ICON_SEND)
    + (edit ? action('edit', 'Edit', ICON_PENCIL) : '')
    + trigger('controls', 'Open artifact controls', ICON_SLIDERS, 'settings', 'Artifact settings')
    + trigger('menu', 'Open menu', ICON_PROFILE, 'profile', 'Profile')
    + '</div>'
    + byline
    + '<span class="mx-reader-toast" data-mx-reader-toast hidden>link copied</span>'
    + '<input class="mx-reader-copy" data-mx-reader-copy type="text" readonly tabindex="-1" aria-hidden="true">'
    + '<button type="button" class="mx-reader-scrim" data-mx-reader-scrim aria-label="Close page controls" hidden></button>'
    + '<nav class="mx-reader-panel mx-reader-panel--menu" data-mx-reader-panel="menu" aria-label="Menu" hidden>'
    + '<a class="mx-reader-brand" href="/" target="_top"><img src="/logo-128.png" alt="">artifactbin</a>'
    + (login ? `<a class="mx-reader-signin" data-mx-login href="${escapeHtml(login.href)}" target="_top" aria-label="Sign in">sign in</a>` : '')
    + '<a href="/" target="_top">Artifacts</a><a href="/account" target="_top">Account</a>'
    + '<a href="/docs-human" target="_top">Human Docs</a><a href="/docs/artifactbin/SKILL.md" target="_top">Agent docs</a>'
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
    + (fork ? renderFork(fork) : '')
    + (forkedFrom ? renderForkedFrom(forkedFrom) : '')
    + '</section></div>';
}
