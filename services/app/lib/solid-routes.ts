import type { ArtifactRole } from './share-roles';

/** The document shell serves every admitted role — viewer, commenter, editor, owner — for a live markup document; a capture render and every other role/format keep the React reader (edit mode is still React's until the Solid editor runtime lands). */
export function solidDocumentReader(role: ArtifactRole, format: string, capture: boolean): boolean {
  return !capture && format === 'markup' && role !== 'none';
}

/** Candidate Solid routes. Admitted document roles select their idle entry at serve time. */
export function isSolidPage(pathname: string, status = 200, artifactFormat?: string): boolean {
  const idRoute = /^\/a\/[^/]+\/?$/.test(pathname);
  const aliasRoute = /^\/@[^/]+\/[^/]+\/?$/.test(pathname);
  if (status === 200 && artifactFormat && (idRoute || aliasRoute)) return idRoute && artifactFormat === 'folder';
  if (status === 200 && artifactFormat === 'dataset' && /^\/a\/[^/]+\/edit\/?$/.test(pathname)) return true;
  return status === 404 || ['/', '/assets', '/datasets/new', '/files/new', '/trash', '/chat', '/login', '/start', '/welcome', '/notifications', '/account', '/docs-human'].includes(pathname)
    || /^\/@[^/]+\/?$/.test(pathname)
    || /^\/a\/[^/]+\/?$/.test(pathname)
    || /^\/@[^/]+\/[^/]+\/?$/.test(pathname);
}
