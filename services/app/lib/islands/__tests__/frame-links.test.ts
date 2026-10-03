/**
 * THE FRAME'S APP LINKS (lib/story-runtime/frame-bridge/links, installed by lib/islands/page in every framed document): a link to an app path inside a document framed on its
 * own origin asks the app page to follow it, and takes the top itself only when nobody answers. The frame's parent is
 * a real jsdom window (another iframe) whose postMessage records what the frame sent; the frame's `top` and `open`
 * are recorders, since jsdom navigates neither.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { appLinkPath, followAppLinks } from '@/lib/story-runtime/frame-bridge/links';
import { STORY_NAVIGATE_MESSAGE, STORY_NAVIGATING_MESSAGE } from '@/lib/story-runtime/contract';

const APP = 'https://app.test';
const DOC = window.location.origin;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The window's own value, its methods bound to it (jsdom's timers refuse a proxy as `this`). */
const bound = (target: Window, key: string | symbol) => {
  const value = Reflect.get(target, key, target) as unknown;
  return typeof value === 'function' && typeof key === 'string' && /^[a-z]/.test(key) ? (value as (...args: unknown[]) => unknown).bind(target) : value;
};

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); document.body.replaceChildren(); });

/** A document framed by `parent`, with its links in `story`; jsdom's own navigation is stopped after the runtime has run. */
function framed(markup: string, answerMs = 40) {
  const parentFrame = document.createElement('iframe');
  document.body.append(parentFrame);
  const parent = parentFrame.contentWindow!;
  const posted: Array<[unknown, string]> = [];
  (parent as { postMessage: unknown }).postMessage = (data: unknown, target: string) => { posted.push([data, target]); };
  const top = { location: { href: '' } };
  const opened: unknown[][] = [];
  const win = new Proxy(window, {
    get: (target, key) => key === 'parent' ? parent : key === 'top' ? top
      : key === 'open' ? (...args: unknown[]) => { opened.push(args); return null; }
      : bound(target, key),
  });
  const story = document.createElement('div');
  story.innerHTML = markup;
  document.body.append(story);
  cleanups.push(followAppLinks(win, APP, answerMs));
  const stopJsdom = (event: Event) => event.preventDefault();
  window.addEventListener('click', stopJsdom);
  cleanups.push(() => window.removeEventListener('click', stopJsdom));
  const click = (selector: string, init: MouseEventInit = {}) => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, button: 0, ...init });
    story.querySelector(selector)!.dispatchEvent(event);
    return event;
  };
  const answer = (href: string, from: { origin?: string; source?: Window } = {}) => window.dispatchEvent(new MessageEvent('message', {
    data: { type: STORY_NAVIGATING_MESSAGE, href }, origin: from.origin ?? APP, source: from.source ?? parent,
  }));
  const navigations = () => posted.filter(([data]) => (data as { type?: string }).type === STORY_NAVIGATE_MESSAGE);
  return { story, posted, navigations, top, opened, click, answer };
}

describe('appLinkPath', () => {
  const here = `${DOC}/a/doc`;
  it.each([
    ['/a/B', '/a/B'],
    ['/', '/'],
    ['/@ada?tab=all#top', '/@ada?tab=all#top'],
    ['next', '/a/next'],
    [`${DOC}/login`, '/login'],
    [`${APP}/account?x=1`, '/account?x=1'],
  ])('an app path: %s → %s', (href, path) => {
    expect(appLinkPath(new URL(href, here).href, href, here, APP)).toBe(path);
  });
  it.each(['#section', ' #section', `${DOC}/a/doc#section`, 'https://elsewhere.test/a/B', 'mailto:ada@example.test', 'javascript:void 0'])('not the app\'s: %s', (href) => {
    let resolved = href;
    try { resolved = new URL(href, here).href; } catch { /* kept */ }
    expect(appLinkPath(resolved, href, here, APP)).toBeNull();
  });
  it('a link without an href attribute is not followed', () => {
    expect(appLinkPath('', null, here, APP)).toBeNull();
  });
});

describe('followAppLinks', () => {
  it('asks the app page to follow a link to an app path, and stands down when it answers', async () => {
    const frame = framed('<a id="next" href="/a/B">Next</a>');
    const event = frame.click('#next');
    expect(event.defaultPrevented).toBe(true);
    expect(frame.navigations()).toEqual([[{ type: STORY_NAVIGATE_MESSAGE, href: '/a/B' }, APP]]);
    frame.answer('/a/B');
    await wait(80);
    expect(frame.top.location.href, 'the app page took it: the frame does not').toBe('');
  });

  it('takes the top to the app\'s address itself when no app page answers', async () => {
    const frame = framed('<a id="home" href="/">Home</a>');
    frame.click('#home');
    await wait(80);
    expect(frame.top.location.href).toBe(`${APP}/`);
  });

  it('an answer from anyone but the parent on the app origin, or for another link, does not stand it down', async () => {
    const frame = framed('<a id="next" href="/a/B?x=1#h">Next</a>');
    frame.click('#next');
    frame.answer('/a/B?x=1#h', { origin: 'https://evil.test' });
    frame.answer('/a/B?x=1#h', { source: window });
    frame.answer('/a/C');
    await wait(80);
    expect(frame.top.location.href).toBe(`${APP}/a/B?x=1#h`);
  });

  it('leaves a hash in the document, another host, a download, an editable region and a link the author handled', async () => {
    const frame = framed([
      '<a id="hash" href="#part">Part</a>',
      '<a id="away" href="https://elsewhere.test/a/B">Away</a>',
      '<a id="file" href="/a/B/assets/x.pdf" download>File</a>',
      '<div contenteditable="true"><a id="editing" href="/a/B">Editing</a></div>',
      '<a id="author" href="/a/B">Author</a>',
    ].join(''));
    frame.story.querySelector('#author')!.addEventListener('click', (event) => event.preventDefault());
    for (const id of ['#hash', '#away', '#file', '#editing', '#author']) frame.click(id);
    await wait(80);
    expect(frame.navigations()).toEqual([]);
    expect(frame.top.location.href).toBe('');
    expect(frame.opened).toEqual([]);
  });

  it('a modified click, a middle click or a link to another tab opens the APP\'s address in a new tab', () => {
    const frame = framed('<a id="plain" href="/a/B">B</a><a id="blank" href="/a/C" target="_blank">C</a>');
    frame.click('#plain', { metaKey: true });
    frame.click('#blank');
    frame.story.querySelector('#plain')!.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
    expect(frame.opened).toEqual([[`${APP}/a/B`, '_blank', 'noopener'], [`${APP}/a/C`, '_blank', 'noopener'], [`${APP}/a/B`, '_blank', 'noopener']]);
    expect(frame.navigations()).toEqual([]);
  });

  it('follows a link an island drew inside a shadow root', () => {
    const frame = framed('<div id="island"></div>');
    const shadow = frame.story.querySelector('#island')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<a href="/@ada"><span>Ada</span></a>';
    shadow.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, button: 0 }));
    expect(frame.navigations()).toEqual([[{ type: STORY_NAVIGATE_MESSAGE, href: '/@ada' }, APP]]);
  });

  it('installs nothing for an app origin that is not an http(s) origin', () => {
    const stop = followAppLinks(window, 'null');
    const link = document.createElement('a');
    link.href = '/a/B';
    document.body.append(link);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    const stopJsdom = (e: Event) => { expect(e.defaultPrevented).toBe(false); e.preventDefault(); };
    window.addEventListener('click', stopJsdom);
    link.dispatchEvent(event);
    window.removeEventListener('click', stopJsdom);
    stop();
  });
});
