/* @jsxImportSource solid-js */
/**
 * THE APP PAGE FOLLOWS ITS FRAME'S LINKS (solid/document/frame-navigation) and REPORTS THE DOCUMENT IT SHOWS
 * (solid/lib/artifact-view-report from solid/pages/Document): a navigation is heard only from the frame's own window on the
 * document's origin, answered before it is taken, followed by the router for an app page and by a full load for any
 * other address; the document page reports one view as it shows its frame.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { Route, Router } from '@solidjs/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORY_NAVIGATE_MESSAGE, STORY_NAVIGATING_MESSAGE } from '@/lib/story-runtime/contract';

const FRAMED_ORIGIN = 'http://646f633132333435.lvh.me';
let served: HTMLElement | null = null;
vi.mock('@/solid/lib/bootstrap', () => ({ takeBootstrap: () => ({ kind: 'account', role: 'viewer', archived: null, surface: { id: 'doc12345', title: 'A doc', format: 'markup', version: 3, framedOrigin: 'http://646f633132333435.lvh.me', author: null } }) }));
vi.mock('@/solid/lib/served-frame', () => ({ adoptServedFrame: () => { const frame = served; served = null; return frame; } }));

import { answerFrameNavigation, appNavigationTarget } from '../frame-navigation';
import { DocumentPage } from '../../pages/Document';

let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetcher = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/annotations')) return Response.json({ annotations: [], next_cursor: null });
    return Response.json({});
  });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  document.body.removeAttribute('data-mx-view-reported');
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

/** A frame in this page whose postMessage records what the page answered. */
function frameIn(parent: HTMLElement = document.body) {
  const frame = document.createElement('iframe');
  parent.append(frame);
  return frame;
}
function recordAnswers(frame: HTMLIFrameElement) {
  const answers: Array<[unknown, string]> = [];
  (frame.contentWindow as { postMessage: unknown }).postMessage = (data: unknown, target: string) => { answers.push([data, target]); };
  return answers;
}
const ask = (href: unknown, source: Window | null, origin = FRAMED_ORIGIN) =>
  window.dispatchEvent(new MessageEvent('message', { data: { type: STORY_NAVIGATE_MESSAGE, href }, origin, source }));

describe('answerFrameNavigation', () => {
  const page = (userActivation?: { isActive: boolean }) => {
    const assign = vi.fn();
    const win = new Proxy(window, {
      get: (target, key) => key === 'location' ? { origin: 'https://app.test', assign }
        : key === 'navigator' ? { userActivation }
        : Reflect.get(target, key, target),
    });
    return { win, assign };
  };

  it('follows an app page through the router and any other address by a full load, answering first', () => {
    const { win, assign } = page();
    const frame = frameIn();
    const answers = recordAnswers(frame);
    const navigate = vi.fn();
    const order: string[] = [];
    navigate.mockImplementation(() => order.push(`navigate:${answers.length}`));
    assign.mockImplementation(() => order.push(`assign:${answers.length}`));
    const stop = answerFrameNavigation({ win, frame, frameOrigin: FRAMED_ORIGIN, navigate });
    ask('/', frame.contentWindow);
    ask('/@ada?tab=all#top', frame.contentWindow);
    ask('/a/B#part', frame.contentWindow);
    ask('/@ada/notes', frame.contentWindow);
    stop();
    ask('/login', frame.contentWindow);
    expect(navigate.mock.calls).toEqual([['/'], ['/@ada?tab=all#top']]);
    expect(assign.mock.calls).toEqual([['https://app.test/a/B#part'], ['https://app.test/@ada/notes']]);
    expect(order, 'each answer goes out before the page moves').toEqual(['navigate:1', 'navigate:2', 'assign:3', 'assign:4']);
    expect(answers).toEqual(['/', '/@ada?tab=all#top', '/a/B#part', '/@ada/notes'].map((href) => [{ type: STORY_NAVIGATING_MESSAGE, href }, FRAMED_ORIGIN]));
  });

  it('hears only the frame\'s own window on the document\'s origin, and only a root-relative path', () => {
    const { win, assign } = page();
    const frame = frameIn();
    const other = frameIn();
    const answers = recordAnswers(frame);
    const navigate = vi.fn();
    const stop = answerFrameNavigation({ win, frame, frameOrigin: FRAMED_ORIGIN, navigate });
    ask('/a/B', other.contentWindow);
    ask('/a/B', frame.contentWindow, 'https://evil.test');
    for (const href of ['//evil.test/a/B', '/\\evil.test', 'https://evil.test/a/B', 'a/B', 42, null]) ask(href, frame.contentWindow);
    stop();
    expect(navigate).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(answers).toEqual([]);
  });

  it('takes no navigation the reader did not click for, where the browser says so', () => {
    const idle = page({ isActive: false });
    const frame = frameIn();
    const answers = recordAnswers(frame);
    const navigate = vi.fn();
    const stop = answerFrameNavigation({ win: idle.win, frame, frameOrigin: FRAMED_ORIGIN, navigate });
    ask('/a/B', frame.contentWindow);
    ask('/', frame.contentWindow);
    stop();
    expect(idle.assign).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(answers, 'unanswered: the frame\'s own fallback meets its sandbox').toEqual([]);
    const clicked = page({ isActive: true });
    const stopClicked = answerFrameNavigation({ win: clicked.win, frame, frameOrigin: FRAMED_ORIGIN, navigate });
    ask('/a/B', frame.contentWindow);
    stopClicked();
    expect(clicked.assign).toHaveBeenCalledWith('https://app.test/a/B');
  });

  it('names the target on this page\'s own origin', () => {
    expect(appNavigationTarget(window, '/a/B?x=1#h')?.href).toBe(`${window.location.origin}/a/B?x=1#h`);
    expect(appNavigationTarget(window, '//elsewhere.test/')).toBeNull();
  });
});

describe('the document page', () => {
  function mount(path = '/a/doc12345') {
    window.history.replaceState(null, '', path);
    const host = document.createElement('div');
    host.setAttribute('data-mx-framed', '');
    const frame = document.createElement('iframe');
    frame.setAttribute('data-mx-document-frame', '');
    host.append(frame);
    document.body.append(host);
    served = host;
    const view = render(() => <Router>
      <Route path="/a/:id" component={DocumentPage} />
      <Route path="/" component={() => <h1>App home</h1>} />
    </Router>);
    return { frame, unmount: view.unmount };
  }
  const viewReports = () => fetcher.mock.calls.filter(([url, init]) => String(url) === '/api/page/artifact/doc12345/view' && (init as RequestInit | undefined)?.method === 'POST');

  it('reports one view of the document it shows, with the served reader\'s request', () => {
    const first = mount();
    expect(viewReports()).toEqual([['/api/page/artifact/doc12345/view', { method: 'POST', credentials: 'same-origin', keepalive: true }]]);
    first.unmount();
    mount();
    expect(viewReports().length, 'the same document shown again in this page is the same view').toBe(1);
  });

  it('follows a link to an app page from its frame through the router', async () => {
    const { frame } = mount();
    // The frame was moved into the page's viewport: its window is the one now in the page.
    const answers = recordAnswers(frame);
    ask('/', frame.contentWindow);
    expect(await screen.findByRole('heading', { name: 'App home' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    // (Leaving the document also detaches its bridge: that envelope is the bridge's, not this answer.)
    expect(answers.filter(([data]) => (data as { type?: string }).type === STORY_NAVIGATING_MESSAGE)).toEqual([[{ type: STORY_NAVIGATING_MESSAGE, href: '/' }, FRAMED_ORIGIN]]);
  });
});
