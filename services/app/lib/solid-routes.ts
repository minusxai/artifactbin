import type { ArtifactRole } from './share-roles';

/**
 * The document shell changes only for view-only readers for now. Browser gates proved that
 * admitting editor/commenter/owner breaks documents with a managed iframe (an author script's
 * sandbox, `window.mx`): CLI/agent mutation and collaborative gates (gate-managed-iframe,
 * gate-testusers, gate-collab-edit, gate-inplace-edit and others) all depend on machinery
 * Document.tsx does not mount yet. Widen this once that runtime lands.
 */
export function solidDocumentReader(role: ArtifactRole, format: string, capture: boolean): boolean {
  return !capture && format === 'markup' && role === 'viewer';
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
