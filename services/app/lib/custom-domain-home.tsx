/**
 * THE HOME PAGE OF A CUSTOM DOMAIN — `/` on a verified host (server/custom-host).
 *
 * It IS the owner's profile listing: the same data the app's `/@handle` page
 * reads (the profile page route, asked as a guest) drawn by the same
 * component (components/ProfileListing, `surface="domain"`) under the same
 * built stylesheet and theme stamp the app page carries. Only the page around
 * it is its own: the head (title, description, unfurl tags, a self-canonical)
 * and the "Made with artifactbin" line a post ends with. Server-rendered once,
 * with no script beyond the theme stamp: a
 * crawler and a reader without JavaScript get every title and link in the
 * first response.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { ListingColumn, NothingHere } from '@/components/Listing';
import { ProfileListing, type ProfileListingData } from '@/components/ProfileListing';
import { escapeHtml } from '@/lib/story/reader-chrome';
import { DOMAIN_FOOTER_TEXT } from '@/lib/story/document';
import { THEME_BOOTSTRAP_HASH, THEME_BOOTSTRAP_SCRIPT } from '@/lib/theme-bootstrap';

export interface DomainHomeInput {
  hostname: string;
  /** The owner's handle and display name; either may be missing. */
  owner: { username: string | null; name: string | null };
  /** The profile page route's answer for a guest; null when the owner has no profile to list. */
  profile: ProfileListingData | null;
  /** The stylesheets the app page links, in its order (web/index.html, as served). */
  stylesheets: string[];
  /** Where the footer's "artifactbin" points: the owner's profile on the app. */
  footerHref: string;
}

/**
 * The page's own policy: one script, the app's theme stamp, admitted by its
 * hash; nothing from anywhere but this host — the app's stylesheet and its
 * fonts, the card thumbnails and the owner's picture. Inline styles stay
 * admitted: the listing's components set a few `style` attributes (an
 * avatar's colour, a card's reveal delay).
 */
export const DOMAIN_HOME_CSP = `default-src 'none'; script-src ${THEME_BOOTSTRAP_HASH}; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

/** The `<link rel="stylesheet">` addresses an HTML shell's head carries, in order. */
export function linkedStylesheets(html: string): string[] {
  const head = html.split(/<\/head>/i)[0] ?? '';
  return [...head.matchAll(/<link\b[^>]*>/gi)]
    .map((tag) => tag[0])
    .filter((tag) => /\brel=["']?stylesheet["'\s>/]/i.test(tag))
    .map((tag) => /\bhref=["']([^"']+)["']/i.exec(tag)?.[1])
    .filter((href): href is string => !!href && href.startsWith('/') && !href.startsWith('//'));
}

export function renderDomainHome(input: DomainHomeInput): string {
  const { hostname, owner, profile, stylesheets, footerHref } = input;
  const heading = owner.name?.trim() || (owner.username ? `@${owner.username}` : hostname);
  const description = `Writing by ${heading}.`;
  const canonical = `https://${hostname}/`;
  const listing = renderToStaticMarkup(
    <ListingColumn>{profile ? <ProfileListing data={profile} surface="domain" /> : <NothingHere />}</ListingColumn>,
  );
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<title>${escapeHtml(heading)}</title>`
    + `<link rel="canonical" href="${escapeHtml(canonical)}">`
    + `<meta name="description" content="${escapeHtml(description)}">`
    + `<meta property="og:type" content="website"><meta property="og:title" content="${escapeHtml(heading)}">`
    + `<meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(canonical)}">`
    + '<link rel="icon" href="/favicon.ico">'
    // The app page's own theme stamp, before any style paints (lib/theme-bootstrap).
    + `<script>${THEME_BOOTSTRAP_SCRIPT}</script>`
    + stylesheets.map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`).join('')
    + `</head><body>${listing}`
    + '<footer class="pb-12 text-center font-mono text-xs text-muted">'
    + `${DOMAIN_FOOTER_TEXT} <a href="${escapeHtml(footerHref)}" rel="noopener" class="text-muted underline underline-offset-2 transition-colors hover:text-accent">artifactbin</a>`
    + '</footer></body></html>';
}
