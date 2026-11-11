/**
 * OLD ADDRESSES, KEPT ANSWERING. The ONE backward-compatibility surface of the URL space (`url-space.ts`).
 * Every public, credential-free file now lives under `/af/` and every short link under `/api/`; each row
 * below is an old root-level prefix that something OUTSIDE this server's control still names: saved page
 * sources and comments, installed skills, sent e-mails, downloaded copies.
 *
 * Nothing teaches these addresses. New code, the skill, guides, examples and generated pages use the
 * `to` address only (the skill's retired-phrasing guard refuses the old ones in agent-facing text).
 *
 * HOW AN OLD ADDRESS IS ANSWERED: an internal rewrite, never a redirect. The server routes the request
 * as if it had named `to` (server/public-files `publicFilePath`, Hono's `getPath`), so the answer is the
 * SAME bytes and headers as the new address: module imports under CORS, fonts, range requests and the
 * immutable cache all behave identically, and installed tooling that fetches with `redirect: 'error'`
 * keeps working. Hosts and policies that look at the requested URL (the pages host, owner hosts, the
 * document CSP) admit the old prefix through `withLegacy`/`canonicalPublicPath`, which read this table.
 * Portable downloads canonicalize a stored source's old URLs the same way before choosing what to pack.
 *
 * RULES
 *  - Nothing new is ever added here. A new public file goes under `/af/`, a new link under `/api/`, from
 *    its first day.
 *  - A row maps one old prefix to one new prefix: the names below it are identical, so `<from><rest>` and
 *    `<to><rest>` are the same file or the same link.
 *  - `server/__tests__/legacy-public-paths.test.ts` proves each row answers exactly as its new address,
 *    and that no root-level public-file prefix exists outside `/af/` except these.
 *
 * DELETING A ROW: when its `deleteWhen` is true (measured, e.g. a production scan of stored page
 * sources and the installed-skill releases still in use), delete the row; the tests, the CSP and the
 * host allowlists follow from the table. Tell the deployment (its proxy imports this table).
 */
export interface LegacyPublicPath {
  /** `file`: a directory of public files, now under `/af/`; `link`: a short redirect link, now under `/api/`. */
  readonly kind: 'file' | 'link';
  /** The old root-level prefix, with its trailing slash. */
  readonly from: string;
  /** The prefix that now owns the same addresses. */
  readonly to: string;
  /** Which already-published thing still names `from`. */
  readonly why: string;
  /** What must be true before the row may go. */
  readonly deleteWhen: string;
}

export const LEGACY_PUBLIC_PATHS: readonly LegacyPublicPath[] = [
  {
    kind: 'file',
    from: '/libraries/',
    to: '/af/lib/',
    why: 'Saved page sources import hosted libraries by URL (`/libraries/<name>-<version>/index.js`), and installed skills\' local preview (scripts/preview-platform.mjs) fetches that address from the server.',
    deleteWhen: 'No stored page source (live, trashed or in version history) contains `/libraries/`, and no installed skill release older than the one teaching `/af/lib/` still updates.',
  },
  {
    kind: 'file',
    from: '/geojson/',
    to: '/af/geojson/',
    why: 'The maps guide taught `fetch("/geojson/<name>.json")`, so saved pages fetch boundary files there; installed skills\' preview server (scripts/preview-server-files.mjs) fetches it with redirect:"error"; downloaded copies in link mode name `<origin>/geojson/…`.',
    deleteWhen: 'No stored page source contains `/geojson/`, no installed skill release older than the one teaching `/af/geojson/` still updates, and link-mode downloads made before the move are accepted as broken.',
  },
  {
    kind: 'file',
    from: '/fonts/',
    to: '/af/fonts/',
    why: 'Content-hashed font files (`/fonts/<name>.<hash8>.woff2`) named by app shells and documents rendered before the move, which browsers and shared caches keep (immutable), and by any stored source that copied a rendered @font-face.',
    deleteWhen: 'A production scan finds no stored page source containing `/fonts/`, and one full release has passed since the move (every cached shell has been replaced).',
  },
  {
    kind: 'link',
    from: '/people/',
    to: '/api/people/',
    why: 'Saved documents and comments store person mentions as `[@name](/people/<id>)` (lib/document/person-mentions), and stored content is never rewritten, so their rendered links keep naming the old address; the parsers accept both forms.',
    deleteWhen: 'Never while any stored document, version or comment contains `(/people/`; only after a migration rewrites stored mentions, which has deliberately not been done.',
  },
  {
    kind: 'link',
    from: '/email/',
    to: '/api/email/',
    why: 'Notification e-mails already delivered carry click links `<origin>/email/<id>` (written by the deployment\'s mail extension through `emailLinkPath` since the move).',
    deleteWhen: '90 days after the deployment\'s mail extension starts writing `emailLinkPath` links: a notification e-mail older than that is not expected to be clicked.',
  },
  {
    kind: 'link',
    from: '/workspace/',
    to: '/api/workspace/',
    why: 'Compatibility only: portable files released long ago may open `<origin>/workspace/<id>` (303 to the page after an edit check). Nothing in this repository emits either address.',
    deleteWhen: 'A production access-log window of 30 days shows no request to `/workspace/` or `/api/workspace/`; then delete the row and app/api/workspace together.',
  },
];

/** `pathname` with a legacy prefix replaced by its `/af/` directory; any other path unchanged. */
export function canonicalPublicPath(pathname: string): string {
  for (const row of LEGACY_PUBLIC_PATHS) if (pathname.startsWith(row.from)) return row.to + pathname.slice(row.from.length);
  return pathname;
}

/** The legacy row an old address belongs to, or null. */
export const legacyPublicPath = (pathname: string): LegacyPublicPath | null =>
  LEGACY_PUBLIC_PATHS.find((row) => pathname.startsWith(row.from)) ?? null;

/** A new prefix and every old prefix that still answers for it (CSP source lists, host allowlists). */
export const withLegacy = (prefix: string): string[] =>
  [prefix, ...LEGACY_PUBLIC_PATHS.filter((row) => row.to === prefix).map((row) => row.from)];
