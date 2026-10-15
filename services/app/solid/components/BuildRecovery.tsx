/* @jsxImportSource solid-js */
/**
 * The app's recovery from a deploy that happened while the tab was open (solid/lib/app-build): the page boundary's
 * fallback, and the router hook that turns a stale page's next navigation into a full load.
 */
import { Show, type JSX } from 'solid-js';
import { useBeforeLeave } from '@solidjs/router';
import { Button } from '../ui/Button';
import { buildStale, isChunkLoadError, navigateFresh, reloadForNewBuild, reloadNow } from '../lib/app-build';

/**
 * Under the router: once the server is known to be on another build, the next in-app navigation loads its address
 * fresh instead of rendering it with this build's code (which may need a chunk that is gone). History moves (a
 * number) go ahead in the app; a chunk they miss is recovered by the boundary.
 */
export function StaleBuildNavigation(): JSX.Element {
  useBeforeLeave((event) => {
    if (!buildStale() || typeof event.to !== 'string' || event.defaultPrevented) return;
    event.preventDefault();
    navigateFresh(event.to);
  });
  return <></>;
}

/**
 * The page boundary's fallback. A missing chunk (or any failure once the page knows it is stale) loads the new build
 * at once — once per build change — and otherwise says so with a Reload that works. Retrying would re-import the
 * same missing chunk, so it is offered only for other failures.
 */
export function PageFailure(props: { error: unknown; reset: () => void }): JSX.Element {
  const skew = isChunkLoadError(props.error) || buildStale();
  const reloading = skew && reloadForNewBuild() === 'reloading';
  const panel = 'mx-auto max-w-5xl px-4 py-10 font-sans text-sm text-fg';
  return (
    <Show when={!reloading} fallback={<main role="status" aria-label="Loading the latest version" aria-busy="true" class={panel}>Loading the latest version…</main>}>
      <main role="alert" class={panel}>
        <p class="m-0 mb-3">{skew ? 'This page was updated while it was open. Reload to continue — your drafts are kept.' : 'Could not load this page.'}</p>
        <div class="flex gap-2">
          <Button size="sm" aria-label="Reload page" onClick={reloadNow}>Reload</Button>
          <Show when={!skew}><Button size="sm" variant="secondary" aria-label="Retry loading page" onClick={props.reset}>Retry</Button></Show>
        </div>
      </main>
    </Show>
  );
}
