/** Whole-document Solid ownership; artifact aliases keep the React reader. */
export function isSolidPage(pathname: string, status = 200): boolean {
  return status === 404 || ['/trash', '/login', '/start', '/welcome', '/notifications', '/account', '/docs-human'].includes(pathname)
    || /^\/@[^/]+\/?$/.test(pathname);
}
