import type { ArtifactRole } from './share-roles';

/**
 * Every admitted role reads a markup document from Solid (solid/pages/Document): the page adopts the
 * compiled story and establishes its controller (solid/document/create-island-story), so comments,
 * the selection bubble, `window.mx` edits and in-place editing all reach it. A capture keeps its own
 * path.
 */
export function solidDocumentReader(role: ArtifactRole, format: string, capture: boolean): boolean {
  return !capture && format === 'markup' && role !== 'none';
}

/**
 * Candidate Solid routes. Admitted document roles select their idle entry at serve time. A folder or
 * dataset is Solid-owned at EITHER address shape — `/a/<id>[/edit]` or its healed pretty form
 * `/@user/<id>[-slug][/edit]` (server/app documentPreparation renders every format at the owner's
 * pretty address once they have a username, so gating on the bare `/a/` shape alone would miss the
 * common case).
 */
export function isSolidPage(pathname: string, status = 200, artifactFormat?: string): boolean {
  const idRoute = /^\/a\/[^/]+\/?$/.test(pathname);
  const aliasRoute = /^\/@[^/]+\/[^/]+\/?$/.test(pathname);
  const editRoute = /^\/(?:a|@[^/]+)\/[^/]+\/edit\/?$/.test(pathname);
  if (status === 200 && artifactFormat && (idRoute || aliasRoute) && !editRoute) return artifactFormat === 'folder';
  if (status === 200 && artifactFormat === 'dataset' && editRoute) return true;
  return status === 404 || ['/', '/assets', '/datasets/new', '/files/new', '/trash', '/chat', '/login', '/start', '/welcome', '/notifications', '/account', '/docs-human'].includes(pathname)
    || /^\/@[^/]+\/?$/.test(pathname)
    || /^\/a\/[^/]+\/?$/.test(pathname)
    || /^\/@[^/]+\/[^/]+\/?$/.test(pathname);
}
