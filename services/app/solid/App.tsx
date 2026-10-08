/* @jsxImportSource solid-js */
/** The Solid app: every route below, every artifact address included. */
import { createEffect, createSignal, ErrorBoundary, lazy, Show, Suspense, type JSX } from 'solid-js';
import { Navigate, Route, Router, type RouteSectionProps } from '@solidjs/router';
import { useParams, useLocation } from '@solidjs/router';
import { SessionProvider } from './lib/session';
import { usePageIntentPreload } from './lib/use-page-data';
import { ChromeVisibilityContext, PageChrome } from './components/PageChrome';
import { OnboardingGate } from './components/OnboardingGate';
import { InboxProvider } from './lib/notifications';
import { dropServedFrameOnRoute, servedDocumentFrame } from '@/solid/lib/served-frame';

// Workspace menus and dialogs are not part of a document reader's startup bundle.
const WorkspaceShell = lazy(() => import('./components/WorkspaceShell'));
const TrashPage = lazy(() => import('./pages/Trash').then((m) => ({ default: m.TrashPage })));
const NotFoundPage = lazy(() => import('./pages/NotFound').then((m) => ({ default: m.NotFoundPage })));
const LoginPage = lazy(() => import('./pages/Login').then((m) => ({ default: m.LoginPage })));
const ConnectPage = lazy(() => import('./pages/Connect').then((m) => ({ default: m.ConnectPage })));
const StartPage = lazy(() => import('./pages/Start').then((m) => ({ default: m.StartPage })));
const WelcomePage = lazy(() => import('./pages/Welcome').then((m) => ({ default: m.WelcomePage })));
const NotificationsPage = lazy(() => import('./pages/Notifications').then((m) => ({ default: m.NotificationsPage })));
const AccountPage = lazy(() => import('./pages/Account').then((m) => ({ default: m.AccountPage })));
const DocsPage = lazy(() => import('./pages/Docs').then((m) => ({ default: m.DocsPage })));
const GettingStartedPage = lazy(() => import('./pages/GettingStarted').then((m) => ({ default: m.GettingStartedPage })));
const ProfilePage = lazy(() => import('./pages/Profile').then((m) => ({ default: m.ProfilePage })));
const ProfileAliasRoute = lazy(() => import('./pages/ProfileAlias').then((m) => ({ default: m.ProfileAliasRoute })));
const HomePage = lazy(() => import('./pages/Home').then((m) => ({ default: m.HomePage })));
const ArtifactAddressRoute = lazy(() => import('./pages/ArtifactAddress').then((m) => ({ default: m.ArtifactAddressRoute })));
const AssetsPage = lazy(() => import('./pages/Assets').then((m) => ({ default: m.AssetsPage })));
const DatasetEditorPage = lazy(() => import('./pages/DatasetEditor').then((m) => ({ default: m.DatasetEditorPage })));
const FileUploadPage = lazy(() => import('./pages/FileUpload').then((m) => ({ default: m.FileUploadPage })));
const SchedulesPage = lazy(() => import('./pages/Schedules').then(m => ({default:m.SchedulesRoute})));
const ProgramPage = lazy(() => import('./pages/Program').then(m => ({default:m.ProgramPage})));
const ProgramEditPage = () => { const params=useParams<{id:string}>(); return <ProgramPage artifactId={params.id}/>; };
const ChatPage = lazy(() => import('./pages/Chat').then((m) => ({ default: m.ChatPage })));
const DocumentPage = lazy(() => import('./pages/Document').then((m) => ({ default: m.DocumentPage })));

function PendingPage(): JSX.Element {
  return <main aria-label="Loading page" role="status" aria-busy="true" class="mx-auto max-w-5xl px-4 py-10"><span class="sr-only">Loading page…</span><div aria-hidden="true" class="h-7 w-48 rounded bg-raised" /></main>;
}

/** Under the SessionProvider: starts a linked page's data on hover, focus or press, ahead of its chunk. */
function IntentPreload(): JSX.Element {
  usePageIntentPreload();
  return <></>;
}

function Root(props: RouteSectionProps): JSX.Element {
  const location = useLocation();
  const workspaceRoute = () => ['/assets', '/trash', '/schedules', '/chat', '/notifications', '/account', '/docs-human', '/getting-started', '/datasets/new', '/files/new', '/programs/new'].includes(location.pathname);
  const servedDocument = !!servedDocumentFrame();
  const documentRoute = () => servedDocument && (/^\/a\/[^/]+(?:\/(?:edit|app))?\/?$/.test(location.pathname) || /^\/@[^/]+\/[^/]+(?:\/edit)?\/?$/.test(location.pathname));
  const [showChrome, setShowChrome] = createSignal(true);
  // Leaving the served document (a link, the onboarding redirect) takes its frame off the page.
  const initialPath = window.location.pathname;
  createEffect(() => {
    dropServedFrameOnRoute(location.pathname);
    if (location.pathname !== initialPath) document.querySelectorAll('[data-mx-pwa]').forEach(node => node.remove());
  });
  return (
    <SessionProvider>
    <IntentPreload />
    <InboxProvider>
    <OnboardingGate>
      <ChromeVisibilityContext.Provider value={setShowChrome}>
        <Show when={!documentRoute() && showChrome()}><PageChrome /></Show>
        <ErrorBoundary fallback={(_, reset) => <main class="mx-auto max-w-5xl px-4 py-10" role="alert">Could not load this page. <button aria-label="Retry loading page" onClick={reset}>Retry</button></main>}>
          <Show when={workspaceRoute()} fallback={<Suspense fallback={<PendingPage />}>{props.children}</Suspense>}><Suspense fallback={<PendingPage />}><WorkspaceShell><Suspense fallback={<PendingPage />}>{props.children}</Suspense></WorkspaceShell></Suspense></Show>
        </ErrorBoundary>
      </ChromeVisibilityContext.Provider>
    </OnboardingGate>
    </InboxProvider>
    </SessionProvider>
  );
}

/**
 * `/a/<id>`: every artifact is Solid's (lib/solid-routes). A document's frame (served into this page) is adopted by
 * the document page; anything served without one — a folder, a data tier, the starter — is routed by its answer.
 */
function ArtifactRoute(): JSX.Element {
  return servedDocumentFrame() ? <DocumentPage /> : <ArtifactAddressRoute />;
}

/** `/a/<id>/edit`: a served document opens in edit mode; a dataset's address is its editor. */
function ArtifactEditRoute(): JSX.Element {
  return servedDocumentFrame() ? <DocumentPage /> : <ArtifactAddressRoute editing />;
}

export function App(): JSX.Element {
  return (
    <Router root={Root}>
      <Route path="/" component={HomePage} />
      <Route path="/a/:id" component={ArtifactRoute} />
      <Route path="/a/:id/app/" component={ArtifactRoute} />
      <Route path="/trash" component={TrashPage} />
      {/* The old tokens page lives in account settings now. */}
      <Route path="/tokens" component={() => <Navigate href="/account" />} />
      <Route path="/assets" component={AssetsPage} />
      <Route path="/datasets/new" component={DatasetEditorPage} />
      <Route path="/files/new" component={FileUploadPage} />
      <Route path="/a/:id/edit" component={ArtifactEditRoute} />
      <Route path="/schedules" component={SchedulesPage} />
      <Route path="/programs/new" component={ProgramPage} />
      <Route path="/programs/:id/edit" component={ProgramEditPage} />
      <Route path="/chat" component={ChatPage} />
      <Route path="/login" component={LoginPage} />
      <Route path="/connect" component={ConnectPage} />
      <Route path="/start" component={StartPage} />
      <Route path="/welcome" component={WelcomePage} />
      <Route path="/notifications" component={NotificationsPage} />
      <Route path="/account" component={AccountPage} />
      <Route path="/docs-human" component={DocsPage} />
      <Route path="/getting-started" component={GettingStartedPage} />
      <Route path="/:user" component={ProfilePage} />
      {/* Every pretty alias — a document, a folder, a dataset's /edit — is ONE route (solid/pages/ProfileAlias.tsx
        * ProfileAliasRoute); a sibling `/:user/:alias` route here would overlap it and win first for
        * every one-segment alias regardless of what it actually names. */}
      <Route path="/:user/*rest" component={ProfileAliasRoute} />
      <Route path="*404" component={NotFoundPage} />
    </Router>
  );
}
