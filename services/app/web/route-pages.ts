import { lazyPage } from './lazy-page';
import { initialStoryFinal, initialStoryKit } from './initial-story';

// Deliberate dynamic-import boundary. Code preloading and rendering share these
// top-level identities; the registry itself never imports a page eagerly.
export const routePages = {
  StartPage: lazyPage<Record<string, never>>(() => import('./pages/Start').then(m => ({ default: m.StartPage }))),
  ChatPage: lazyPage<Record<string, never>>(() => import('./pages/Chat').then(m => ({ default: m.ChatPage }))),
  NotificationsPage: lazyPage<Record<string, never>>(() => import('./pages/Notifications').then(m => ({ default: m.NotificationsPage }))),
  AccountPage: lazyPage<Record<string, never>>(() => import('./pages/Account').then(m => ({ default: m.AccountPage }))),
  AssetsPage: lazyPage<Record<string, never>>(() => import('./pages/Assets').then(m => ({ default: m.AssetsPage }))),
  DatasetEditorPage: lazyPage<{artifactId?: string; onSaved?: () => Promise<unknown>}>(() => import('./pages/DatasetEditor').then(m => ({ default: m.DatasetEditorPage }))),
  FileUploadPage: lazyPage<Record<string, never>>(() => import('./pages/FileUpload').then(m => ({ default: m.FileUploadPage }))),
  DocsPage: lazyPage<Record<string, never>>(() => import('./pages/Docs').then(m => ({ default: m.DocsPage }))),
  HomePage: lazyPage<Record<string, never>>(() => import('./pages/Home').then(m => ({ default: m.HomePage }))),
  LoginPage: lazyPage<Record<string, never>>(() => import('./pages/Login').then(m => ({ default: m.LoginPage }))),
  NotFoundPage: lazyPage<Record<string, never>>(() => import('./pages/NotFound').then(m => ({ default: m.NotFoundPage }))),
  ProfilePage: lazyPage<Record<string, never>>(() => import('./pages/Profile').then(m => ({ default: m.ProfilePage })), true),
  TrashPage: lazyPage<Record<string, never>>(() => import('./pages/Trash').then(m => ({ default: m.TrashPage }))),
  WelcomePage: lazyPage<Record<string, never>>(() => import('./pages/Welcome').then(m => ({ default: m.WelcomePage }))),
  ArtifactPage: lazyPage<{ id?: string }>(() => import('./pages/Artifact').then(m => ({ default: m.ArtifactPage })), true),
};

/**
 * Everything a server-rendered DOCUMENT's first app render draws: the route
 * pages, the inline runtime that hydrates the story and the kit chunks the
 * story draws — or, for a story served FINAL, the route pages alone: it keeps
 * its served markup and runs no runtime (components/FinalStory). The server
 * names every one of them in the head (server/reader-preloads), so awaiting
 * them before the first render costs nothing — and it lets every boundary
 * render its module on that first commit, where a lazy read would suspend and
 * reveal behind React's fallback throttle.
 */
export function preloadDocumentReader(): Promise<void> {
  const pages = [routePages.ProfilePage.preload(), routePages.ArtifactPage.preload()];
  if (initialStoryFinal()) return Promise.all(pages).then(() => undefined);
  const runtime = import('./pages/Artifact').then(m => m.preloadInlineStoryRuntime(initialStoryKit()));
  return Promise.all([...pages, runtime]).then(() => undefined);
}
