/**
 * THE HOME PAGE OF A CUSTOM DOMAIN — `/` on a verified host (server/custom-host).
 *
 * It IS the owner's profile listing: the same data the app's `/@handle` page
 * reads (the profile page route, asked as a guest), drawn as the same markup
 * `components/ProfileListing` produces for `surface="domain"` — but hand-built
 * here rather than through React, since this page ships no script at all
 * beyond the theme stamp (there is nothing left to hydrate, and the CSP
 * forbids any other script). Only the page around it is its own: the head
 * (title, description, unfurl tags, a self-canonical) and the "Made with
 * artifactbin" line a post ends with. Server-rendered once, with no script
 * beyond the theme stamp: a crawler and a reader without JavaScript get every
 * title and link in the first response.
 *
 * Keep this in parity with `components/ProfileListing.tsx` + `components/
 * Listing.tsx` + `components/Shelf.tsx`'s `surface="domain"` branch — the
 * server test (`server/__tests__/custom-domain-host.test.ts`) checks the two
 * render the same markup, less the follow header and the toolbar (script the
 * domain page cannot run).
 */
import { escapeHtml } from '@artifactbin/utils/escape';
import { DOMAIN_FOOTER_TEXT } from '@/lib/story/document-styles';
import { THEME_BOOTSTRAP_HASH, THEME_BOOTSTRAP_SCRIPT } from '@/lib/theme-bootstrap';
import { personFaceBackground, personInitial } from '@/lib/person-face';
import { buildShelf, groupShelfByRecency, type ShelfRow } from '@/lib/shelf';
import { domainPostPath } from '@/lib/urls';
import { CARD_RENDER_GENERATION } from '@/lib/export-card';

/** A public file, as the profile page route answers it (`strip()` in app/api/page/profile). */
interface ProfileFile {
  id: string;
  format: string;
  title?: string | null;
  updated_at: string;
  version: number;
}

/** The profile page route's answer for a guest — what the home page's listing needs from it. */
export interface ProfileListingData {
  handle: string;
  owner?: { id: string; image?: string | null };
  files: ProfileFile[];
}

export interface DomainHomeInput {
  hostname: string;
  /** The owner's handle and display name; either may be missing. */
  owner: { username: string | null; name: string | null };
  /** The profile page route's answer for a guest; null when the owner has no profile to list. */
  profile: ProfileListingData | null;
  /** Where the footer's "artifactbin" points: the owner's profile on the app. */
  footerHref: string;
  /** The stylesheets the app page links, in its order (web/solid-app.html, as served). */
  stylesheets: string[];
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

/** components/Listing's `NothingHere`. */
const NOTHING_HERE_HTML = '<p class="reveal font-mono text-sm text-muted"><span class="text-accent">$</span> nothing here yet<span class="caret text-accent">▍</span></p>';

/** components/Avatar, at the one size (48) ListingHero draws it. */
function avatarHtml(userId: string, image: string | null | undefined, initial: string, size: number): string {
  const faceStyle = `background-color:${personFaceBackground(userId)};font-size:${Math.round(size * 0.42)}px`;
  const picture = image ? `<img src="${escapeHtml(image)}" alt="" class="absolute inset-0 size-full object-cover">` : '';
  return `<span aria-hidden="true" style="width:${size}px;height:${size}px" class="relative block shrink-0 overflow-hidden rounded-full">`
    + `<span data-face-initial="" style="${faceStyle}" class="flex size-full items-center justify-center font-semibold leading-none text-white">${escapeHtml(personInitial(initial))}</span>`
    + picture
    + '</span>';
}

/** components/Listing's `ListingHero`, `surface="domain"` (no follow header — that needs a session and /api). */
function listingHeroHtml(handle: string, count: number, owner?: { id: string; image?: string | null }): string {
  const avatar = owner ? avatarHtml(owner.id, owner.image, handle, 48) : '';
  return '<header class="reveal mb-8">'
    + '<span class="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">public index</span>'
    + `<div class="mt-2 flex items-center gap-3">${avatar}`
    + '<h1 class="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-3xl font-semibold tracking-tight text-fg">'
    + '<a href="/" aria-label="Profile root" class="min-w-0 [overflow-wrap:anywhere] no-underline transition-colors hover:text-accent">'
    + `<span class="text-accent">@</span>${escapeHtml(handle)}`
    + '</a></h1></div>'
    + `<p class="mt-3 font-mono text-xs text-muted">${count} public artifact${count === 1 ? '' : 's'}</p>`
    + '</header>';
}

/** components/Shelf's `Thumb`. */
function thumbHtml(row: ProfileFile): string {
  const src = `/a/${row.id}/export?format=jpg&mode=card&v=${row.version}&r=${CARD_RENDER_GENERATION}`;
  return '<span class="relative block w-full overflow-hidden bg-raised gallery-paper aspect-[5/3] rounded-[4px] border border-edge shadow-sm">'
    + '<span class="absolute inset-0 flex items-center justify-center"><span class="h-4 w-4 animate-spin rounded-full border-2 border-edge-bright border-t-accent"></span></span>'
    + `<img src="${escapeHtml(src)}" alt="" loading="lazy" class="relative h-full w-full object-cover">`
    + '</span>';
}

/** components/Shelf's grid card — `showVisibility={false}`, `actions="share"` and no `views`, so nothing else draws over the thumbnail. */
function documentCardHtml(row: ProfileFile, url: string, index: number): string {
  const name = row.title ?? row.id;
  const delay = Math.min(index * 35, 280);
  return `<li class="reveal group relative flex min-w-0 flex-col duration-150 gallery-document rounded-md p-1 sm:p-2 transition-colors hover:bg-raised/60" style="animation-delay:${delay}ms">`
    + `<div class="relative">${thumbHtml(row)}</div>`
    + '<div class="flex flex-1 flex-col gap-2 px-1 pt-2.5 pb-1"><div class="flex items-start justify-center gap-1.5">'
    + `<a href="${escapeHtml(url)}" aria-label="Open ${escapeHtml(name)}" class="block font-mono leading-snug font-semibold text-fg no-underline transition-colors after:absolute after:inset-0 group-hover:text-accent text-center text-[13px] line-clamp-2">${escapeHtml(row.title ?? 'Untitled')}</a>`
    + '</div></div></li>';
}

/**
 * components/Shelf's `surface="domain"` branch: no toolbar (search, filters,
 * the grid/list toggle — controls that need the SPA's script), so it is
 * always the grid, date-grouped, and never the "no matches" state (nothing
 * can filter what there is no script to filter with).
 */
function shelfHtml(files: ProfileFile[]): string {
  // `assets={false}`: non-markup rows (images, datasets) are excluded from the
  // shelf itself, even though they kept ProfileListing from drawing NothingHere.
  const markup = files.filter((f) => f.format === 'markup') as unknown as ShelfRow[];
  const documents = buildShelf(markup).documents;
  const groups = groupShelfByRecency(documents);
  const sections = groups.map((group) => {
    const cards = group.rows.map((row) => {
      const file = row as unknown as ProfileFile;
      return documentCardHtml(file, domainPostPath({ id: file.id, title: file.title ?? null }), documents.indexOf(row));
    }).join('');
    return `<section aria-label="${escapeHtml(group.label)} artifacts">`
      + '<div class="mb-2.5 flex items-center gap-3 px-0.5">'
      + `<h2 class="shrink-0 font-mono text-[10px] font-medium uppercase tracking-[0.13em] text-muted">${escapeHtml(group.label)}</h2>`
      + '<span aria-hidden="true" class="h-px flex-1 bg-edge"></span></div>'
      + `<ul class="grid grid-cols-2 gap-2 sm:gap-5 lg:grid-cols-4">${cards}</ul>`
      + '</section>';
  }).join('');
  const grid = documents.length > 0 ? `<div aria-label="Artifact grid" class="flex flex-col gap-7">${sections}</div>` : '';
  return `<section aria-label="Shelf" data-shelf-view="grid" class="flex flex-col gap-4">${grid}</section>`;
}

/** components/ProfileListing, `surface="domain"`: folders are dropped (a folder's page is not served on the domain, so its tile would be a dead link). */
function profileListingHtml(data: ProfileListingData): string {
  const files = data.files.filter((f) => f.format !== 'folder');
  const count = files.filter((f) => f.format === 'markup').length;
  const hero = listingHeroHtml(data.handle, count, data.owner);
  return hero + (files.length === 0 ? NOTHING_HERE_HTML : shelfHtml(files));
}

export function renderDomainHome(input: DomainHomeInput): string {
  const { hostname, owner, profile, stylesheets, footerHref } = input;
  const heading = owner.name?.trim() || (owner.username ? `@${owner.username}` : hostname);
  const description = `Writing by ${heading}.`;
  const canonical = `https://${hostname}/`;
  // components/Listing's `ListingColumn` — the column alone, with no app bar above it.
  const listing = `<main class="mx-auto max-w-4xl px-4 sm:px-6 pt-10 pb-24">${profile ? profileListingHtml(profile) : NOTHING_HERE_HTML}</main>`;
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
