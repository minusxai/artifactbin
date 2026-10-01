/**
 * THE READER-CHROME ADAPTER (solid/document/reader-chrome-adapter): the served rail's presses, Escape and
 * the panel triggers' aria state, shared by solid/pages/Document and solid/pages/Starter; and the like/follow
 * press, which answers a sign-in refusal exactly as the controls panel's LikeAction does.
 */
import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { renderReaderChrome } from '@/lib/story/reader/reader-chrome';
import { PAGE_DATA_CHANGED } from '@/web/page-data-events';
import { syncPanelTriggers, toggleReaction, wireReaderChrome, type ReaderPanel } from '../reader-chrome-adapter';

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); window.history.replaceState(null, '', '/'); });

const draw = (liked = false, count = 2, following = false): HTMLElement => {
  const holder = document.body.appendChild(document.createElement('div'));
  holder.innerHTML = renderReaderChrome({
    artifactId: 'abc', title: 'Doc', author: { username: 'ana' }, panels: false,
    reactions: { like: { liked, count, href: '#' }, follow: { following, count: 0, href: '#' }, comment: { count: 0, href: '#' } },
  });
  return holder;
};
const control = (root: HTMLElement, name: string) => root.querySelector<HTMLElement>(`[data-mx-reader-action="${name}"]`)!;
const trigger = (root: HTMLElement, name: string) => root.querySelector<HTMLElement>(`[data-mx-reader-trigger="${name}"]`)!;
const signInRefusal = () => Response.json({ error: 'sign_in_required' }, { status: 401 });

/** Wire the rail as the pages do: like/follow go through toggleReaction, the rest to `onAction`. */
const wire = (root: HTMLElement, navigate = vi.fn(), signedIn = true) => {
  const onAction = vi.fn();
  const onMode = vi.fn();
  let dispose!: () => void;
  const wired = createRoot((d) => {
    dispose = d;
    const [panel, setPanel] = createSignal<ReaderPanel | null>(null);
    const wiring = wireReaderChrome(root, {
      panel, setPanel, onMode,
      onAction: (name) => name === 'like' ? toggleReaction(root, 'like', '/api/my/artifacts/abc/like', { signedIn, navigate }) : onAction(name),
    });
    return { panel, setPanel, wiring };
  });
  return { ...wired, onAction, onMode, navigate, dispose: () => { wired.wiring.dispose(); dispose(); } };
};

it('sends a signed-in reader whose like the server refuses for sign-in to login, from the rail', async () => {
  window.history.replaceState(null, '', '/a/abc?x=1#note');
  vi.stubGlobal('fetch', vi.fn(async () => signInRefusal()));
  const root = draw();
  const rail = wire(root);
  control(root, 'like').click();
  await vi.waitFor(() => expect(rail.navigate).toHaveBeenCalledTimes(1));
  const callback = new URL(rail.navigate.mock.calls[0]![0] as string, location.origin).searchParams.get('callbackUrl');
  expect(callback).toBe('/a/abc?x=1&intent=like#note');
  expect(control(root, 'like').getAttribute('data-mx-liked')).toBe('false');
  rail.dispose();
});

it('sends a signed-out reader to login without asking the server', async () => {
  const fetcher = vi.fn(async () => Response.json({}));
  vi.stubGlobal('fetch', fetcher);
  const root = draw();
  const navigate = vi.fn();
  await toggleReaction(root, 'follow', '/api/users/u1/follow', { signedIn: false, navigate });
  expect(navigate).toHaveBeenCalledWith(expect.stringContaining('intent%3Dfollow'));
  expect(fetcher).not.toHaveBeenCalled();
});

it('flips the like state, its label and the count on success, and says the page data changed', async () => {
  const fetcher = vi.fn(async () => Response.json({ liked: true, count: 3 }));
  vi.stubGlobal('fetch', fetcher);
  const changed = vi.fn();
  window.addEventListener(PAGE_DATA_CHANGED, changed);
  const root = draw(false, 2);
  await toggleReaction(root, 'like', '/api/my/artifacts/abc/like', { signedIn: true, navigate: vi.fn() });
  window.removeEventListener(PAGE_DATA_CHANGED, changed);
  expect(fetcher).toHaveBeenCalledWith('/api/my/artifacts/abc/like', { method: 'POST', credentials: 'same-origin' });
  const like = control(root, 'like');
  expect(like.getAttribute('data-mx-liked')).toBe('true');
  expect(like.getAttribute('aria-label')).toBe('Unlike');
  expect(like.querySelector('[data-mx-reader-count]')!.textContent).toBe('3');
  expect(changed).toHaveBeenCalledTimes(1);
});

it('unfollows with DELETE and relabels the follow button by its author', async () => {
  const fetcher = vi.fn(async () => Response.json({ following: false, count: 0 }));
  vi.stubGlobal('fetch', fetcher);
  const root = draw(false, 0, true);
  await toggleReaction(root, 'follow', '/api/users/u1/follow', { signedIn: true, navigate: vi.fn() });
  expect(fetcher).toHaveBeenCalledWith('/api/users/u1/follow', { method: 'DELETE', credentials: 'same-origin' });
  const follow = control(root, 'follow');
  expect(follow.getAttribute('data-mx-following')).toBe('false');
  expect(follow.getAttribute('aria-label')).toBe('Follow @ana');
  expect(follow.textContent).toBe('follow');
});

it('leaves the rail as it was when the server fails, without navigating', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'boom' }, { status: 500 })));
  const root = draw(true, 5);
  const before = control(root, 'like').outerHTML;
  const navigate = vi.fn();
  await toggleReaction(root, 'like', '/api/my/artifacts/abc/like', { signedIn: true, navigate });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
  await toggleReaction(root, 'like', '/api/my/artifacts/abc/like', { signedIn: true, navigate });
  expect(control(root, 'like').outerHTML).toBe(before);
  expect(navigate).not.toHaveBeenCalled();
});

it('opens a panel from its trigger, revealing the rail, and closes it on Escape', () => {
  const root = draw();
  const chrome = root.querySelector<HTMLElement>('[data-mx-reader-chrome]')!;
  chrome.classList.add('mx-reader-chrome--hidden');
  chrome.setAttribute('data-mx-reader-state', 'hidden');
  const rail = wire(root);
  trigger(root, 'controls').click();
  expect(rail.panel()).toBe('controls');
  expect(chrome.getAttribute('data-mx-reader-state')).toBe('shown');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(rail.panel()).toBeNull();
  rail.dispose();
  // Disposed: Escape no longer reaches the page.
  rail.setPanel('menu');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(rail.panel()).toBe('menu');
});

it('keeps each trigger\'s aria-expanded and label in step with the panel, however it changes', () => {
  const root = draw();
  const rail = wire(root);
  trigger(root, 'menu').click();
  expect(trigger(root, 'menu').getAttribute('aria-expanded')).toBe('true');
  expect(trigger(root, 'menu').getAttribute('aria-label')).toBe('Close menu');
  expect(trigger(root, 'controls').getAttribute('aria-expanded')).toBe('false');
  void rail.wiring.act('controls');
  expect(trigger(root, 'controls').getAttribute('aria-expanded')).toBe('true');
  expect(trigger(root, 'controls').getAttribute('aria-label')).toBe('Close artifact controls');
  expect(trigger(root, 'menu').getAttribute('aria-expanded')).toBe('false');
  rail.setPanel(null); // the scrim
  expect(trigger(root, 'controls').getAttribute('aria-expanded')).toBe('false');
  expect(trigger(root, 'controls').getAttribute('aria-label')).toBe('Open artifact controls');
  rail.dispose();
});

it('restores the open trigger\'s state after the chrome is redrawn', () => {
  const root = draw();
  const rail = wire(root);
  trigger(root, 'controls').click();
  root.innerHTML = draw().innerHTML;
  expect(trigger(root, 'controls').getAttribute('aria-expanded')).toBe('false');
  syncPanelTriggers(root, rail.panel());
  expect(trigger(root, 'controls').getAttribute('aria-expanded')).toBe('true');
  rail.dispose();
});

it('hands other presses and the mode choice to the page, and ignores the title editor', () => {
  const root = draw();
  root.querySelector('[data-mx-reader-chrome]')!.insertAdjacentHTML('beforeend',
    '<button data-mx-mode-choice="dark">dark</button><span data-mx-title-editor><button data-mx-reader-action="edit">t</button></span>');
  const rail = wire(root);
  control(root, 'comment').click();
  expect(rail.onAction).toHaveBeenCalledWith('comment');
  root.querySelector<HTMLElement>('[data-mx-mode-choice]')!.click();
  expect(rail.onMode).toHaveBeenCalledWith('dark');
  root.querySelector<HTMLElement>('[data-mx-title-editor] button')!.click();
  expect(rail.onAction).toHaveBeenCalledTimes(1);
  rail.dispose();
});
