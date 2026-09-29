/* @jsxImportSource solid-js */
/** Solid owns the entire Trash route. Other destinations load their React document. */
import { ErrorBoundary, lazy, onMount, Suspense, type JSX } from 'solid-js';
import { Route, Router, type RouteSectionProps } from '@solidjs/router';
import { SessionProvider } from './web/session';

const TrashPage = lazy(() => import('./pages/Trash').then((m) => ({ default: m.TrashPage })));
const NotFoundPage = lazy(() => import('./pages/NotFound').then((m) => ({ default: m.NotFoundPage })));

function PendingPage(): JSX.Element {
  return <main aria-label="Loading page" role="status" aria-busy="true" class="mx-auto max-w-5xl px-4 py-10"><span class="sr-only">Loading page…</span><div aria-hidden="true" class="h-7 w-48 rounded bg-raised" /></main>;
}

function Root(props: RouteSectionProps): JSX.Element {
  return (
    <SessionProvider>
      <header class="flex items-center justify-between border-b border-edge bg-surface px-4 py-3 font-mono text-xs">
        <a href="/" rel="external" aria-label="Artifacts" class="font-semibold text-fg no-underline">artifactbin</a>
        <nav aria-label="Page navigation" class="flex items-center gap-4">
          <a href="/notifications" rel="external" aria-label="Notifications" class="text-muted hover:text-fg">Notifications</a>
          <a href="/account" rel="external" aria-label="Account" class="text-muted hover:text-fg">Account</a>
        </nav>
      </header>
      <ErrorBoundary fallback={(_, reset) => <main class="mx-auto max-w-5xl px-4 py-10" role="alert">Could not load this page. <button aria-label="Retry loading page" onClick={reset}>Retry</button></main>}>
        <Suspense fallback={<PendingPage />}>{props.children}</Suspense>
      </ErrorBoundary>
    </SessionProvider>
  );
}

function LeaveToReact(): JSX.Element {
  onMount(() => window.location.reload());
  return <main role="status" class="p-6">Opening sign in…</main>;
}

export function App(): JSX.Element {
  return (
    <Router root={Root}>
      <Route path="/trash" component={TrashPage} />
      <Route path="/login" component={LeaveToReact} />
      <Route path="*404" component={NotFoundPage} />
    </Router>
  );
}
