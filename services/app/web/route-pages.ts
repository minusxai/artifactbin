import { lazyPage } from './lazy-page';

// Deliberate dynamic-import boundary. Code preloading and rendering share these
// top-level identities; the registry itself never imports a page eagerly.
export const routePages = {
  ChatPage: lazyPage<Record<string, never>>(() => import('./pages/Chat').then(m => ({ default: m.ChatPage }))),
  DatasetEditorPage: lazyPage<{artifactId?: string; onSaved?: () => Promise<unknown>}>(() => import('./pages/DatasetEditor').then(m => ({ default: m.DatasetEditorPage }))),
  NotFoundPage: lazyPage<Record<string, never>>(() => import('./pages/NotFound').then(m => ({ default: m.NotFoundPage }))),
  ProfilePage: lazyPage<Record<string, never>>(() => import('./pages/Profile').then(m => ({ default: m.ProfilePage })), true),
  ArtifactPage: lazyPage<{ id?: string }>(() => import('./pages/Artifact').then(m => ({ default: m.ArtifactPage })), true),
};

/**
 * Everything a server-rendered DOCUMENT's first app render draws: the route
 * pages and the inline runtime that hydrates the story. The server names every
 * one of them in the head (server/reader-preloads), so awaiting them before the
 * first render costs nothing — and it lets every boundary render its module on
 * that first commit, where a lazy read would suspend and reveal behind React's
 * fallback throttle.
 */
export function preloadDocumentReader(): Promise<void> {
  return Promise.all([routePages.ProfilePage.preload(), routePages.ArtifactPage.preload()]).then(() => undefined);
}
