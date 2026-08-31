/**
 * WHERE YOU ARE, AS A TRAIL — the bar's name for the current page, and the
 * way back up from it.
 *
 * The bar used to print a page NAME, absolutely centered, beside a brand mark
 * that was already a link home. Two pieces of chrome saying two halves of one
 * thing: the mark said where you are hosted, the name said which page, and
 * nothing said how they related or offered the step between them. A trail says
 * both at once and is navigable — `artifact-bin › @vivek › My doc` gets you
 * back to the profile in one tap, which on a phone is the difference between
 * navigation and the back button.
 *
 * The ROOT is not in this list. The brand mark IS the root crumb and the bar
 * renders it unconditionally, so this function answers only "what comes after
 * artifact-bin".
 *
 * TWO RULES, both about the 390px screen this is drawn on:
 *
 *  - AT MOST ONE ANCESTOR. A profile's folder path can be five deep, and five
 *    crumbs in a 44px bar is a row of ellipses. The handle is the one ancestor
 *    worth a tap; the folder segments already have their own breadcrumb in the
 *    profile's own hero (`app/[user]/[[...path]]` ListingHero), which is where
 *    there is width to draw them.
 *  - THE TITLE WINS THE LEAF. A document names itself, and its address
 *    (`/@vivek/notes/ab12-my-doc`) is decoration around an id. Whoever renders
 *    a document passes the name it actually has.
 */

export interface Crumb {
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

/** A profile path — `/@handle`, optionally with folders and a document after it. */
const HANDLE_RE = /^\/(@[a-z0-9_]+)(\/.*)?$/;

export function crumbsFor(pathname: string, title?: string | null): Crumb[] {
  const path = pathname.replace(/\/+$/, '') || '/';
  const named = title?.trim() || null;

  const handle = HANDLE_RE.exec(path);
  if (handle) {
    const [, at, rest] = handle;
    // The handle itself: one crumb, and it IS the page.
    if (!rest) return [{ label: at }];
    // Below it: the handle becomes the way back, and the leaf is the document
    // by name — or, on a folder listing, the folder itself.
    const last = rest.split('/').filter(Boolean).at(-1) ?? '';
    return [{ label: at, href: `/${at}` }, { label: named ?? last }];
  }

  // A document at its universal short address has no ancestor to offer: `/a`
  // is not a page. Its name is the whole trail.
  if (path.startsWith('/a/')) return [{ label: named ?? 'artifact' }];

  // Every /docs address is the same destination as far as the bar cares — the
  // human tour and the agent protocol doc are two readings of one thing.
  if (path === '/docs' || path.startsWith('/docs/')) return [{ label: 'docs' }];

  const name = PAGE_NAMES[path] ?? named;
  return name ? [{ label: name }] : [];
}
