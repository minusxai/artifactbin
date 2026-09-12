import { lazyPage } from './lazy-page';

// Deliberate dynamic-import boundary. Code preloading and rendering share these
// top-level identities; the registry itself never imports a page eagerly.
export const routePages = {
  ChatPage: lazyPage<Record<string, never>>(() => import('./pages/Chat').then(m => ({ default: m.ChatPage }))),
  AccountPage: lazyPage<Record<string, never>>(() => import('./pages/Account').then(m => ({ default: m.AccountPage }))),
  AssetsPage: lazyPage<Record<string, never>>(() => import('./pages/Assets').then(m => ({ default: m.AssetsPage }))),
  DatasetEditorPage: lazyPage<{artifactId?: string; onSaved?: () => Promise<unknown>}>(() => import('./pages/DatasetEditor').then(m => ({ default: m.DatasetEditorPage }))),
  DocsPage: lazyPage<Record<string, never>>(() => import('./pages/Docs').then(m => ({ default: m.DocsPage }))),
  HomePage: lazyPage<Record<string, never>>(() => import('./pages/Home').then(m => ({ default: m.HomePage }))),
  PrivacyPage: lazyPage<Record<string, never>>(() => import('./pages/Legal').then(m => ({ default: m.PrivacyPage }))),
  TermsPage: lazyPage<Record<string, never>>(() => import('./pages/Legal').then(m => ({ default: m.TermsPage }))),
  LoginPage: lazyPage<Record<string, never>>(() => import('./pages/Login').then(m => ({ default: m.LoginPage }))),
  NotFoundPage: lazyPage<Record<string, never>>(() => import('./pages/NotFound').then(m => ({ default: m.NotFoundPage }))),
  ProfilePage: lazyPage<Record<string, never>>(() => import('./pages/Profile').then(m => ({ default: m.ProfilePage })), true),
  TrashPage: lazyPage<Record<string, never>>(() => import('./pages/Trash').then(m => ({ default: m.TrashPage }))),
  ArtifactPage: lazyPage<{ id?: string }>(() => import('./pages/Artifact').then(m => ({ default: m.ArtifactPage })), true),
};
