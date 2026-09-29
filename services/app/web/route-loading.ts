import { artifactViewPath, parsePrettyPath } from '@/lib/urls';
import { isClientRoute } from './NavigationBoundary';
import { routePages } from './route-pages';

/** Browser-only route knowledge; no page implementations or second data cache. */
export function routeLoading(url: Pick<URL, 'pathname' | 'search'>): { identity: string; code: Array<{ preload(): Promise<void> }>; key?: string } | null {
  if (!isClientRoute(url)) return null;
  const path = artifactViewPath(url.pathname).replace(/\/$/, '') || '/';
  const direct = /^\/a\/([^/]+)$/.exec(path);
  const pretty = path.startsWith('/@') ? parsePrettyPath(path.split('/').slice(2)) : null;
  const id = direct?.[1] ?? pretty?.id;
  if (id) return { identity: `artifact:${id}`, code: [routePages.ProfilePage, routePages.ArtifactPage], key: `/api/page/artifact/${id}${url.search}` };
  if (path.startsWith('/@')) {
    const [user, ...rest] = path.slice(1).split('/');
    return { identity: path, code: [routePages.ProfilePage], key: `/api/page/profile/${encodeURIComponent(user)}${rest.length ? '/' + rest.join('/') : ''}` };
  }
  return null;
}
