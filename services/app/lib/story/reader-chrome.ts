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
  + ` stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const ICON_HEART = ICON('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21.2l7.7-7.7 1.1-1.1a5.5 5.5 0 0 0 0-7.8z"/>');
const ICON_COMMENT = ICON('<path d="M21 11.5a8.4 8.4 0 0 1-9 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 4 12a8.4 8.4 0 0 1 8.5-9 8.4 8.4 0 0 1 8.5 8.5z"/>');
const ICON_SEND = ICON('<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>');
const ICON_PENCIL = ICON('<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>');
// `mx-rc-open`, like the sliders: the glyph a trigger swaps for the X while its panel is open.
const ICON_PROFILE = '<svg class="mx-rc-open" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M6.2 19a6 6 0 0 1 11.6 0"/></svg>';
const ICON_SLIDERS = `<svg class="mx-rc-open" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>`;
const ICON_X = '<svg class="mx-rc-close" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12"/></svg>';
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
const action = (name: 'like' | 'comment' | 'share' | 'edit', aria: string, icon: string): string =>
  `<button type="button" class="mx-reader-action" data-mx-reader-action="${name}" aria-label="${aria}" data-mx-tip="${aria}">`
  + `${icon}${label(name)}</button>`;

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
  const { artifactId, title, author, signIn = null, fork = null, login = null, edit = false } = input;
  const username = author?.username ?? null;
  const forkedFrom = author?.forkedFrom ?? null;

  const byline = '<div class="mx-reader-byline" data-mx-reader-byline>'
    + (username
      ? `<a class="mx-reader-author" href="/@${escapeHtml(username)}" target="_top"`
        + ` aria-label="View @${escapeHtml(username)}'s profile">@${escapeHtml(username)}</a>`
      : '')
    // FOLLOW rides right beside the handle it follows, and only when there is
    // one: an anonymous document has nobody to follow. UI only for now — the
    // entry logs it with the author, the way like and comment log.
    + (title ? `<span class="mx-reader-title">${escapeHtml(title)}</span>` : '')
    + (username
      ? `<button type="button" class="mx-reader-follow" data-mx-reader-action="follow" data-mx-author="${escapeHtml(username)}"`
        + ` aria-label="Follow @${escapeHtml(username)}" data-mx-tip="Follow @${escapeHtml(username)}">follow</button>`
      : '')
    + '</div>';

  // The heading appears when the panel has anything to say about THIS
  // document; each of the three arrives independently of the others.
  const aboutThis = signIn || fork || forkedFrom;

  return `<div class="mx-reader-chrome ${READER_CHROME_HIDDEN_CLASS}" data-mx-reader-chrome data-mx-reader-state="hidden"`
    + `${artifactId ? ` data-mx-artifact-id="${escapeHtml(artifactId)}"` : ''}>`
    + '<a class="mx-reader-home" href="/" target="_top" aria-label="Home" data-mx-reader-logo data-mx-tip="Home">'
    + '<img src="/logo-128.png" alt=""></a>'
    + '<div class="mx-reader-rail" data-mx-reader-rail>'
    + action('like', 'Like', ICON_HEART)
    + action('comment', 'Comment', ICON_COMMENT)
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
