/** Whole-document Solid ownership; artifact aliases keep the React reader. */
export function isSolidPage(pathname: string, status = 200, artifactFormat?: string): boolean {
  if (status === 200 && artifactFormat === 'folder' && /^\/a\/[^/]+\/?$/.test(pathname)) return true;
  if (status === 200 && artifactFormat === 'dataset' && /^\/a\/[^/]+\/edit\/?$/.test(pathname)) return true;
  return status === 404 || ['/', '/assets', '/datasets/new', '/files/new', '/trash', '/login', '/start', '/welcome', '/notifications', '/account', '/docs-human'].includes(pathname)
    || /^\/@[^/]+\/?$/.test(pathname);
}
