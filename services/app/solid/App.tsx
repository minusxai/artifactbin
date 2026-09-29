/* @jsxImportSource solid-js */
/** Solid owns the entire Trash route. Other destinations load their React document. */
import { ErrorBoundary, lazy, Suspense, type JSX } from 'solid-js';
import { Route, Router, type RouteSectionProps } from '@solidjs/router';
import { SessionProvider } from './web/session';
import { PageChrome } from './components/PageChrome';
import { InboxProvider } from './web/notifications';

const TrashPage = lazy(() => import('./pages/Trash').then((m) => ({ default: m.TrashPage })));
const NotFoundPage = lazy(() => import('./pages/NotFound').then((m) => ({ default: m.NotFoundPage })));
const LoginPage = lazy(() => import('./pages/Login').then((m) => ({ default: m.LoginPage })));
const StartPage = lazy(() => import('./pages/Start').then((m) => ({ default: m.StartPage })));
const WelcomePage = lazy(() => import('./pages/Welcome').then((m) => ({ default: m.WelcomePage })));
const NotificationsPage = lazy(() => import('./pages/Notifications').then((m) => ({ default: m.NotificationsPage })));
const AccountPage = lazy(() => import('./pages/Account').then((m) => ({ default: m.AccountPage })));
const DocsPage = lazy(() => import('./pages/Docs').then((m) => ({ default: m.DocsPage })));
const ProfilePage = lazy(() => import('./pages/Profile').then((m) => ({ default: m.ProfilePage })));

function PendingPage(): JSX.Element {
  return <main aria-label="Loading page" role="status" aria-busy="true" class="mx-auto max-w-5xl px-4 py-10"><span class="sr-only">Loading page…</span><div aria-hidden="true" class="h-7 w-48 rounded bg-raised" /></main>;
}

function Root(props: RouteSectionProps): JSX.Element {
  return (
    <SessionProvider>
    <InboxProvider>
      <PageChrome />
      <ErrorBoundary fallback={(_, reset) => <main class="mx-auto max-w-5xl px-4 py-10" role="alert">Could not load this page. <button aria-label="Retry loading page" onClick={reset}>Retry</button></main>}>
        <Suspense fallback={<PendingPage />}>{props.children}</Suspense>
      </ErrorBoundary>
    </InboxProvider>
    </SessionProvider>
  );
}

export function App(): JSX.Element {
  return (
    <Router root={Root}>
      <Route path="/trash" component={TrashPage} />
      <Route path="/login" component={LoginPage} />
      <Route path="/start" component={StartPage} />
      <Route path="/welcome" component={WelcomePage} />
      <Route path="/notifications" component={NotificationsPage} />
      <Route path="/account" component={AccountPage} />
      <Route path="/docs-human" component={DocsPage} />
      <Route path="/:user" component={ProfilePage} />
      <Route path="*404" component={NotFoundPage} />
    </Router>
  );
}
