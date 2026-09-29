/* @jsxImportSource solid-js */
/** Solid owns the entire Trash route. Other destinations load their React document. */
import { ErrorBoundary, lazy, Show, Suspense, type JSX } from 'solid-js';
import { Route, Router, type RouteSectionProps } from '@solidjs/router';
import { useLocation } from '@solidjs/router';
import { SessionProvider } from './web/session';
import { PageChrome } from './components/PageChrome';
import { OnboardingGate } from './components/OnboardingGate';
import { InboxProvider } from './web/notifications';
import { initialDocumentStory } from '@/web/initial-story';

const TrashPage = lazy(() => import('./pages/Trash').then((m) => ({ default: m.TrashPage })));
const NotFoundPage = lazy(() => import('./pages/NotFound').then((m) => ({ default: m.NotFoundPage })));
const LoginPage = lazy(() => import('./pages/Login').then((m) => ({ default: m.LoginPage })));
const StartPage = lazy(() => import('./pages/Start').then((m) => ({ default: m.StartPage })));
const WelcomePage = lazy(() => import('./pages/Welcome').then((m) => ({ default: m.WelcomePage })));
const NotificationsPage = lazy(() => import('./pages/Notifications').then((m) => ({ default: m.NotificationsPage })));
const AccountPage = lazy(() => import('./pages/Account').then((m) => ({ default: m.AccountPage })));
const DocsPage = lazy(() => import('./pages/Docs').then((m) => ({ default: m.DocsPage })));
const ProfilePage = lazy(() => import('./pages/Profile').then((m) => ({ default: m.ProfilePage })));
const HomePage = lazy(() => import('./pages/Home').then((m) => ({ default: m.HomePage })));
const FolderRoute = lazy(() => import('./pages/Folder').then((m) => ({ default: m.FolderRoute })));
const AssetsPage = lazy(() => import('./pages/Assets').then((m) => ({ default: m.AssetsPage })));
const DatasetEditorPage = lazy(() => import('./pages/DatasetEditor').then((m) => ({ default: m.DatasetEditorPage })));
const FileUploadPage = lazy(() => import('./pages/FileUpload').then((m) => ({ default: m.FileUploadPage })));
const ChatPage = lazy(() => import('./pages/Chat').then((m) => ({ default: m.ChatPage })));
const DocumentPage = lazy(() => import('./pages/Document').then((m) => ({ default: m.DocumentPage })));

function PendingPage(): JSX.Element {
  return <main aria-label="Loading page" role="status" aria-busy="true" class="mx-auto max-w-5xl px-4 py-10"><span class="sr-only">Loading page…</span><div aria-hidden="true" class="h-7 w-48 rounded bg-raised" /></main>;
}

function Root(props: RouteSectionProps): JSX.Element {
  const location = useLocation();
  const servedDocument = !!initialDocumentStory();
  const documentRoute = () => servedDocument && (/^\/a\/[^/]+\/?$/.test(location.pathname) || /^\/@[^/]+\/[^/]+\/?$/.test(location.pathname));
  return (
    <SessionProvider>
    <InboxProvider>
    <OnboardingGate>
      <Show when={!documentRoute()}><PageChrome /></Show>
      <ErrorBoundary fallback={(_, reset) => <main class="mx-auto max-w-5xl px-4 py-10" role="alert">Could not load this page. <button aria-label="Retry loading page" onClick={reset}>Retry</button></main>}>
        <Suspense fallback={<PendingPage />}>{props.children}</Suspense>
      </ErrorBoundary>
    </OnboardingGate>
    </InboxProvider>
    </SessionProvider>
  );
}

function ArtifactRoute(): JSX.Element {
  return initialDocumentStory() ? <DocumentPage /> : <FolderRoute />;
}

export function App(): JSX.Element {
  return (
    <Router root={Root}>
      <Route path="/" component={HomePage} />
      <Route path="/a/:id" component={ArtifactRoute} />
      <Route path="/trash" component={TrashPage} />
      <Route path="/assets" component={AssetsPage} />
      <Route path="/datasets/new" component={DatasetEditorPage} />
      <Route path="/files/new" component={FileUploadPage} />
      <Route path="/a/:id/edit" component={DatasetEditorPage} />
      <Route path="/chat" component={ChatPage} />
      <Route path="/login" component={LoginPage} />
      <Route path="/start" component={StartPage} />
      <Route path="/welcome" component={WelcomePage} />
      <Route path="/notifications" component={NotificationsPage} />
      <Route path="/account" component={AccountPage} />
      <Route path="/docs-human" component={DocsPage} />
      <Route path="/:user/:alias" component={DocumentPage} />
      <Route path="/:user" component={ProfilePage} />
      <Route path="*404" component={NotFoundPage} />
    </Router>
  );
}
