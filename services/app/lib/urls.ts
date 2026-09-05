/**
 * The URL grammar — pure functions, no DB, no Next.
 *
 * One rule anchors everything: the file ID resolves the document; the username
 * and the title slug in a URL are DECORATION. Any path whose last segment
 * starts with a valid id loads, then self-corrects to the canonical form with
 * a redirect. That is what makes renames (username, title, a move between
 * folders) free: no link ever breaks, it just heals.
 *
 * NESTING IS NEVER IN A URL. A folder is an artifact with its own address, and
 * two sibling folders may share a name — so a path through them is ambiguous
 * by construction, and the address stayed decoration while the trail
 * (`ancestor_ids`) is drawn on the page. The old folder segments and their
 * grammar are gone, not kept.
 *
 * Canonical forms:
 *   /a/<id>                            anonymous (or owner has no username yet)
 *   /@<username>/<id>[-<title-slug>]   owned
 */
import { ID_RE } from './ids-shape';

/** Derived from the title on every render — never stored, never trusted on read. */
export function titleSlug(title: string | null | undefined): string {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

/** `<id>` or `<id>-<anything>` — the ONLY segment shape that names a file. */
const FILE_SEGMENT_RE = /^([a-zA-Z0-9]{6,12})(?:-(.*))?$/;

/**
 * The forgiving parse: given the path segments AFTER /@username/, find the
 * file id. Null = the last segment can't carry one. Everything before the last
 * segment is ignored on purpose — resolution is by id alone, which is what
 * lets an OLD link carrying folder names keep working after the grammar died.
 */
export function parsePrettyPath(segments: string[]): { id: string } | null {
  const last = segments[segments.length - 1];
  if (!last) return null;
  const m = FILE_SEGMENT_RE.exec(last);
  if (!m || !ID_RE.test(m[1])) return null;
  return { id: m[1] };
}

export function canonicalArtifactPath(
  doc: { id: string; title: string | null },
  ownerUsername: string | null,
): string {
  if (!ownerUsername) return `/a/${doc.id}`;
  const slug = titleSlug(doc.title);
  return `/@${ownerUsername}/${slug ? `${doc.id}-${slug}` : doc.id}`;
}
