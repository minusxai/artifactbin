import type { ArtifactRole } from './share-roles';

/** The document shell changes only for readers. Writers still need the React editor. */
export function solidDocumentReader(role: ArtifactRole, format: string, capture: boolean): boolean {
  return !capture && format === 'markup' && (role === 'viewer' || role === 'commenter');
}

/** Candidate Solid routes. Admitted document roles select their idle entry at serve time. */
export function isSolidPage(pathname: string, status = 200, artifactFormat?: string): boolean {
  if (status === 200 && artifactFormat === 'folder' && /^\/a\/[^/]+\/?$/.test(pathname)) return true;
  if (status === 200 && artifactFormat === 'dataset' && /^\/a\/[^/]+\/edit\/?$/.test(pathname)) return true;
  if (status === 200 && artifactFormat === 'markup' && (/^\/a\/[^/]+\/?$/.test(pathname) || /^\/@[^/]+\/[^/]+\/?$/.test(pathname))) return false;
  return status === 404 || ['/', '/assets', '/datasets/new', '/files/new', '/trash', '/chat', '/login', '/start', '/welcome', '/notifications', '/account', '/docs-human'].includes(pathname)
    || /^\/@[^/]+\/?$/.test(pathname)
    || /^\/a\/[^/]+\/?$/.test(pathname)
    || /^\/@[^/]+\/[^/]+\/?$/.test(pathname);
}
