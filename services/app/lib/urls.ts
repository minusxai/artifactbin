/**
 * The URL grammar — pure functions, no DB, no Next.
 *
 * One rule anchors everything: the file ID resolves the document; username,
 * folders, and title slug in a URL are DECORATION. Any path whose last
 * segment starts with a valid id loads, then self-corrects to the canonical
 * form with a redirect. That is what makes renames (username, title, folder
 * moves) free: no link ever breaks, it just heals.
 *
 * Canonical forms:
 *   /a/<id>                                        anonymous (or owner has no username yet)
 *   /@<username>/<folder>/.../<id>[-<title-slug>]  owned
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
 * file id. Null = the last segment can't carry one (so it's a folder path,
 * or nothing). Everything before the last segment is ignored on purpose —
 * resolution is by id alone.
 */
export function parsePrettyPath(segments: string[]): { id: string } | null {
  const last = segments[segments.length - 1];
  if (!last) return null;
  const m = FILE_SEGMENT_RE.exec(last);
  if (!m || !ID_RE.test(m[1])) return null;
  return { id: m[1] };
}

export function canonicalArtifactPath(
  doc: { id: string; title: string | null; folder: string },
  ownerUsername: string | null,
): string {
  if (!ownerUsername) return `/a/${doc.id}`;
  const slug = titleSlug(doc.title);
  const file = slug ? `${doc.id}-${slug}` : doc.id;
  const folder = doc.folder ? `${doc.folder}/` : '';
  return `/@${ownerUsername}/${folder}${file}`;
}

const FOLDER_SEGMENT_RE = /^[a-zA-Z0-9_-]{1,40}$/;
const MAX_FOLDER_DEPTH = 8;
const MAX_FOLDER_LENGTH = 200;

/**
 * Normalize a folder path ('a/b/c'; '' = root). Stray and doubled slashes
 * collapse (they carry no meaning); a segment that fails the charset, or a
 * path too deep/long, is null — reject, never silently truncate.
 */
export function parseFolder(value: string): string | null {
  const segments = value.split('/').filter((s) => s !== '');
  if (segments.length === 0) return '';
  if (segments.length > MAX_FOLDER_DEPTH) return null;
  for (const s of segments) {
    if (!FOLDER_SEGMENT_RE.test(s)) return null;
  }
  const joined = segments.join('/');
  return joined.length <= MAX_FOLDER_LENGTH ? joined : null;
}
