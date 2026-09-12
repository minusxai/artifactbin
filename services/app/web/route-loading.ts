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
  const app: Record<string, { code: typeof routePages.AccountPage; key?: string }> = {
    '/': { code: routePages.HomePage, key: '/api/page/home?part=core' },
    '/account': { code: routePages.AccountPage, key: '/api/page/account' },
    '/trash': { code: routePages.TrashPage, key: '/api/page/trash' },
    // Custom fallback/error loaders stay with their pages. Copying those here
    // would change retry semantics; code loading still overlaps their route.
    '/assets': { code: routePages.AssetsPage }, '/chat': { code: routePages.ChatPage },
    '/privacy': { code: routePages.PrivacyPage }, '/terms': { code: routePages.TermsPage },
    '/login': { code: routePages.LoginPage },
    '/docs-human': { code: routePages.DocsPage },
  };
  const match = app[path] ?? (path.startsWith('/datasets/') ? { code: routePages.DatasetEditorPage } : null);
  return match ? { identity: path, ...match, code: [match.code] } : null;
}
