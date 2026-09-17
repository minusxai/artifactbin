/**
 * WHERE YOU ARE, AS A TRAIL — the bar's name for the current page, and the
 * way back up from it.
 *
 * A bare page name beside a brand mark says two halves of one thing — where you
 * are hosted and which page — without saying how they relate or offering the
 * step between them. A trail says both at once and is navigable:
 * `artifactbin › @vivek › My doc` gets you back to the profile in one tap,
 * which on a phone is the difference between navigation and the back button.
 *
 * The ROOT is not in this list. The brand mark IS the root crumb and the bar
 * renders it unconditionally, so this function answers only "what comes after
 * artifactbin".
 *
 * TWO RULES, both about the 390px screen this is drawn on:
 *
 *  - AT MOST ONE ANCESTOR. The handle is the one crumb worth a tap in a 44px
 *    bar. Nesting is not in a URL (lib/urls), so a pretty address is `@handle`
 *    and one leaf, and the trail through a folder is drawn on the folder's own
 *    document from `ancestor_ids`. A link still carrying folder names resolves
 *    by its id and heals; until it does, its extra segments are ignored here.
 *  - THE TITLE WINS THE LEAF. A document names itself, and its address
 *    (`/@vivek/notes/ab12-my-doc`) is decoration around an id. Whoever renders
 *    a document passes the name it actually has.
 */

interface Crumb {
  /** What it says. */
  label: string;
  /** Where it goes. ABSENT means this is the page you are on. */
  href?: string;
}

/** The app's own pages, named for the bar. */
const PAGE_NAMES: Record<string, string> = {
  '/account': 'account',
  '/tokens': 'tokens',
  '/login': 'log in',
};

/** A profile path — `/@handle`, optionally with a document (and any decoration) after it. */
const HANDLE_RE = /^\/(@[a-z0-9_]+)(\/.*)?$/;

export function crumbsFor(pathname: string, title?: string | null): Crumb[] {
  const path = pathname.replace(/\/+$/, '') || '/';
  const named = title?.trim() || null;

  const handle = HANDLE_RE.exec(path);
  if (handle) {
    const [, at, rest] = handle;
    // The handle itself: one crumb, and it IS the page.
    if (!rest) return [{ label: at }];
    // Below it: the handle becomes the way back, and the leaf is the artifact
    // by name — a document or a folder alike, since a folder is one.
    const last = rest.split('/').filter(Boolean).at(-1) ?? '';
    return [{ label: at, href: `/${at}` }, { label: named ?? last }];
  }

  // A document at its universal short address has no ancestor to offer: `/a`
  // is not a page. Its name is the whole trail.
  if (path.startsWith('/a/')) return [{ label: named ?? 'artifact' }];

  // `/docs-human` is the one docs page the app serves; every `/docs…` address
  // is a 404 the shell never mounts under.
  if (path === '/docs-human') return [{ label: 'docs' }];

  const name = PAGE_NAMES[path] ?? named;
  return name ? [{ label: name }] : [];
}
