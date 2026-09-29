/**
 * The document shell now serves readers and commenters (solid/document/AnnotationLayer carries
 * the annotation rail both need). Editor and owner stay on React: browser gates proved those
 * roles need machinery Document.tsx does not mount yet — CLI/agent mutation via the managed
 * iframe on write-capable sessions, the owner's share dialog and in-place editing (gate-managed-
 * iframe, gate-testusers, gate-collab-edit, gate-inplace-edit). Widen further once that lands.
 */
export function solidDocumentReader(role: ArtifactRole, format: string, capture: boolean): boolean {
  return !capture && format === 'markup' && (role === 'viewer' || role === 'commenter');
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
