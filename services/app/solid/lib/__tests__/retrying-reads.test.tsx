/* @jsxImportSource solid-js */
/**
 * The app shell's and the reader's own reads go through the shared retry (lib/http/retry-lazily), each one held to the
 * same contract (lib/http/__tests__/retrying-read): 502/503/504 and a dropped connection are asked again, a 4xx is not,
 * and a read that carries an AbortSignal stops when it aborts.
 */
import { createRoot } from 'solid-js';
import { render } from 'solid-js/web';
import { expect, it, vi } from 'vitest';
import { describeRetryingRead } from '@/lib/http/__tests__/retrying-read';
import { retryingFetch } from '@/lib/http/retry-lazily';
import { createHttpBackend } from '@/lib/artifact-backend/http';
import { apiFetch } from '../api';
import { SessionProvider, useSession } from '../session';
import { usePageData } from '../use-page-data';
import { useSetupDeployment } from '../deployment-setup';
import { freshFrameSrc } from '../../document/frame-src';
import { fetchFrameNodes } from '../../document/create-framed-story';

const ok = (body: unknown) => () => Response.json(body);
const pathOf = (url: string) => new URL(url, 'http://app.test').pathname;

/** A Solid root that the read's abort disposes (an unmount). */
function mounted<T>(primitive: () => T): { value: T; dispose: () => void } {
  return createRoot((dispose) => ({ value: primitive(), dispose }));
}

{
  let answer: Response | null = null;
  describeRetryingRead('retryingFetch', () => ({
    start: () => { const c = new AbortController(); answer = null; void retryingFetch('/api/x', { signal: c.signal }).then((r) => { answer = r; }, () => {}); return { abort: () => c.abort() }; },
    landed: () => answer?.status === 200,
  }), { matches: (url) => url === '/api/x', ok: ok({}), abortable: true });
}

{
  let answer: Response | null = null;
  describeRetryingRead('apiFetch GET', () => ({
    start: () => { const c = new AbortController(); answer = null; void apiFetch('/api/my/thing', 'GET', undefined, { signal: c.signal }).then((r) => { answer = r; }, () => {}); return { abort: () => c.abort() }; },
    landed: () => answer?.status === 200,
  }), { matches: (url) => url === '/api/my/thing', ok: ok({}), abortable: true });
}

{
  let src: string | null = null;
  describeRetryingRead('freshFrameSrc', () => ({
    start: () => { src = null; void freshFrameSrc('Doc1', '').then((value) => { src = value; }); },
    landed: () => src === 'https://pages.test/ticket',
  }), { matches: (url) => url === '/api/page/frame/Doc1', ok: ok({ src: 'https://pages.test/ticket' }) });
}

{
  let nodes: unknown = null;
  describeRetryingRead('fetchFrameNodes', () => ({
    start: () => { const c = new AbortController(); nodes = null; void fetchFrameNodes('Doc1', '', c.signal).then((value) => { nodes = value; }); return { abort: () => c.abort() }; },
    landed: () => Array.isArray(nodes),
  }), { matches: (url) => url === '/api/page/artifact/Doc1?part=nodes', ok: ok({ nodes: [] }), abortable: true });
}

{
  let src: string | null = null;
  describeRetryingRead('the backend\'s documentFrame', () => ({
    start: () => { src = null; void createHttpBackend('Doc1').documentFrame('Doc2').then((value) => { src = value; }); },
    landed: () => src === 'https://pages.test/companion',
  }), { matches: (url) => url === '/api/page/frame/Doc2', ok: ok({ src: 'https://pages.test/companion' }) });
}

{
  let container: HTMLElement | null = null;
  let unmount: (() => void) | null = null;
  describeRetryingRead('the session read', () => ({
    start: () => {
      unmount?.(); container?.remove();
      container = document.body.appendChild(document.createElement('div'));
      function Probe() { const { session } = useSession(); return <p>{session()?.kind ?? 'none'}</p>; }
      unmount = render(() => <SessionProvider><Probe /></SessionProvider>, container);
    },
    landed: () => container?.textContent === 'account',
  }), { matches: (url) => url === '/api/page/session', ok: ok({ kind: 'account', user: { id: 'u1' }, onboarded: true }) });
}

{
  let page: ReturnType<typeof mounted<ReturnType<typeof usePageData<{ name: string }>>>> | null = null;
  describeRetryingRead('page data (usePageData)', () => ({
    start: () => { page?.dispose(); page = mounted(() => usePageData<{ name: string }>('/api/page/profile/@me')); return { abort: () => page!.dispose() }; },
    landed: () => page?.value.data()?.name === 'me',
  }), { matches: (url) => url === '/api/page/profile/@me', ok: ok({ name: 'me' }), abortable: true });
}

{
  let deployment: ReturnType<typeof mounted<ReturnType<typeof useSetupDeployment>>> | null = null;
  describeRetryingRead('the deployment read', () => ({
    start: () => { deployment?.dispose(); deployment = mounted(() => useSetupDeployment()); },
    landed: () => deployment?.value()?.mode === 'company',
  }), { matches: (url) => pathOf(url) === '/api/deployment', ok: ok({ mode: 'company' }) });
}

it('sends a write once, even when the server is restarting', async () => {
  const send = vi.fn(async () => new Response('{}', { status: 503 }));
  vi.stubGlobal('fetch', send);
  try {
    expect((await apiFetch('/api/my/thing', 'POST', { a: 1 })).status).toBe(503);
    expect(send).toHaveBeenCalledTimes(1);
  } finally { vi.unstubAllGlobals(); }
});
