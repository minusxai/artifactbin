/**
 * THE DOCUMENT HOST MODULE (lib/html-reader/host-shell, /af/host.js) through the real app server: a plain HTML host
 * page on the app's own origin mounts a document, and the page's `sql` reaches the real door as
 * the signed-in reader, pinned to the served revision exactly as the app page's bridge pins them. A signed-out or
 * unauthorised reader gets the app page's refusals; a host page on another origin is refused by the module.
 *
 * The browser is a JSDOM window at the host page's address whose `fetch` is the app server with the reader's session
 * (what a same-origin `credentials: 'same-origin'` request carries); the framed document's side of the bridge is
 * played by messages from the frame's window on the document's origin, as its door sends them.
 */
import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it } from 'vitest';
import { attachActor } from '@artifactbin/utils';
import type { Actor } from '@artifactbin/contracts';
import { getDb, setServices } from '@/lib/platform';
import { createArtifactFromBody } from '@/lib/publish';
import { identityForUser } from '@/lib/accounts';
import { pagesOriginFor, pagesSite } from '@/lib/http';
import { mountDocument, HostShellError, type MountedDocument } from '../host-shell';
import type { HostComments, HostCommentsModule, HostCommentsOptions } from '../host-comments-contract';
import { STORY_FRAME_BRIDGE_MESSAGE } from '../contract';
import { createAppServer } from '@/server/app';
import { mintAccountToken, useAppHarness } from '@/__tests__/harness';
import { guideExamples } from '@/test/helpers/skill-docs';

/** This deployment's pages site, as the frame endpoint reads it: the app's public origin frames its documents. */
const site = pagesSite();
const APP = site.app;
const app = createAppServer({ indexHtml: async () => '<!doctype html><html><body><div id="root"></div></body></html>', pagesSite: site });

const harness = useAppHarness();
beforeAll(() => { setServices({ humanSessions: { live: async (ref) => ref.startsWith('host-') } }); });

const world = harness.shared(async () => {
  const owner = await mintAccountToken('host_owner'), stranger = await mintAccountToken('host_stranger');
  const actor = identityForUser(owner.userId, owner.id, owner.email);
  const dataset = await createArtifactFromBody({ access: 'readwrite', visibility: 'unlisted', dataset: [{ name: 'ada' }, { name: 'bo' }], title: 'People' }, actor, APP);
  const people = (await dataset.json() as { id: string }).id;
  await (await getDb()).query('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1', [people, JSON.stringify({ version: 3, tables: [{ table: { schema: 'public', name: 'rows' }, select_permissions: [
    { role: 'signed_in', permission: { columns: '*', filter: {} } }, { role: 'anonymous', permission: { columns: ['name'], filter: {} } }] }] })]);
  const head = `<link rel="af-dataset" data-af-name="people" href="ref:${people}">`;
  const publish = async (visibility: string) => {
    const created = await createArtifactFromBody({ visibility, html: `<html><head>${head}</head><body><h1 data-af-id="title">Plan</h1></body></html>` }, actor, APP);
    const body = await created.json() as { id: string };
    expect(created.status, JSON.stringify(body)).toBe(201);
    return body.id;
  };
  return { owner, stranger, privatePage: await publish('private'), publicPage: await publish('public') };
});

const session = (who: { userId: string | null; email: string | null } | null): Actor | null =>
  who?.userId ? { credential: 'session', sessionId: `host-${who.userId}`, userId: who.userId, email: who.email ?? '', emailVerified: true } : null;

/** A host page at `origin` whose same-origin requests are the app server's, carrying `reader`'s session. */
function hostPage(reader: Actor | null, origin = APP) {
  const dom = new JSDOM('<!doctype html><html><body><main id="host"></main></body></html>', { url: `${origin}/shell` });
  const win = dom.window as unknown as Window & typeof globalThis;
  win.fetch = (async (input: string | URL, init?: RequestInit) => {
    const request = new Request(new URL(String(input), APP), init);
    return app.request(reader ? attachActor(request, reader) : request);
  }) as typeof fetch;
  return { win, container: win.document.getElementById('host')! };
}

/** The framed document's side: its door's hello and ready, then the page's own `fetch` calls, answered through the bridge. */
function framedDocument(win: Window & typeof globalThis, mounted: MountedDocument) {
  const posted: Array<{ message: { key: string; payload: Record<string, unknown> }; target: string }> = [];
  const frameWindow = mounted.frame.contentWindow!;
  frameWindow.postMessage = ((message: never, target: string) => { posted.push({ message, target }); }) as Window['postMessage'];
  const send = (payload: unknown, key?: string) => win.dispatchEvent(new win.MessageEvent('message', { data: { type: STORY_FRAME_BRIDGE_MESSAGE, ...(key ? { key } : {}), payload }, origin: mounted.origin, source: frameWindow }));
  send({ kind: 'hello' });
  const attach = posted.find((entry) => entry.message.payload.kind === 'attach')!;
  send({ kind: 'ready', nonce: 'n'.repeat(16) }, attach.message.key);
  let call = 0;
  const fetchThrough = async (path: string, method: 'GET' | 'POST', body: string | null) => {
    const id = ++call;
    send({ kind: 'fetch', call: id, path, method, headers: { 'content-type': 'application/json' }, body }, attach.message.key);
    await expect.poll(() => posted.some((entry) => entry.message.payload.kind === 'fetch-result' && entry.message.payload.call === id), { timeout: 10_000 }).toBe(true);
    const result = posted.find((entry) => entry.message.payload.kind === 'fetch-result' && entry.message.payload.call === id)!.message.payload as { status?: number; body?: string; error?: string };
    return { status: result.status, error: result.error, body: (result.body === undefined ? null : JSON.parse(result.body)) as Record<string, unknown> };
  };
  return { posted, attach, fetchThrough };
}

describe('a host page on the app\'s own origin', () => {
  it('mounts a private document for its signed-in reader, whose sql runs as that reader on the served revision', async () => {
    const w = world();
    const { win, container } = hostPage(session(w.owner));
    const ready: unknown[] = [];
    container.addEventListener('af-document-ready', (event) => ready.push((event as CustomEvent).detail));
    const mounted = await mountDocument(container, { id: w.privatePage, title: 'Plan' }, win);
    // Exactly the app page's frame: the document's own origin, its sandbox and permissions, a one-time ticket.
    expect(mounted.origin).toBe(pagesOriginFor(w.privatePage, site));
    expect(mounted.frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation allow-downloads');
    expect(mounted.frame.getAttribute('allow')).toBe('fullscreen; clipboard-write');
    expect(new URL(mounted.frame.src).origin).toBe(mounted.origin);
    expect(new URL(mounted.frame.src).searchParams.get('_pt')).toBeTruthy();
    expect(mounted.revision).toBe('1');
    const doc = framedDocument(win, mounted);
    // Every message to the frame goes to the document's origin, never '*'.
    expect(new Set(doc.posted.map((entry) => entry.target))).toEqual(new Set([mounted.origin]));
    expect(doc.attach.message.payload).toMatchObject({ kind: 'attach', id: w.privatePage });
    expect(ready).toEqual([{ nonce: 'n'.repeat(16) }]);

    const rows = await doc.fetchThrough(`/api/artifacts/${w.privatePage}/sql`, 'POST', JSON.stringify({ sql: 'select name from people order by name', params: {} }));
    expect(rows.status, JSON.stringify(rows.body)).toBe(200);
    expect(rows.body.rows).toEqual([{ name: 'ada' }, { name: 'bo' }]);
    // The relays stay pinned as on the app page: another document's door is never reached.
    expect(await doc.fetchThrough(`/api/artifacts/${w.publicPage}/sql`, 'POST', JSON.stringify({ sql: 'select 1', params: {} }))).toMatchObject({ error: 'refused' });
    // A path no relay knows (a page function's, which no longer exists) is refused, never reached.
    expect(await doc.fetchThrough(`/api/artifacts/${w.privatePage}/fn/whoami`, 'POST', '{}')).toMatchObject({ error: 'refused' });
    // The parent's commands reach the frame through the bridge.
    mounted.setMode('dark');
    mounted.select('title', { reveal: true });
    mounted.scrollToHash('#plan');
    // The host's own Back or Forward: the page's route follows the `$` values it hands over.
    mounted.setUrlValues('?$screen=list');
    const commands = doc.posted.map((entry) => entry.message as unknown as { type?: string; payload?: { kind: string; command?: unknown } });
    expect(commands.some((message) => (message.payload?.command as { type?: string })?.type === 'mx:reader-mode')).toBe(true);
    expect(commands.some((message) => (message.payload?.command as { type?: string; path?: string })?.path === 'title')).toBe(true);
    expect(commands.some((message) => message.type === 'mx:frame-hash')).toBe(true);
    expect(doc.posted.map((entry) => entry.message)).toContainEqual({ type: 'mx:url-values', search: '?$screen=list' });
    mounted.destroy();
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('gives a signed-out or unauthorised reader the app page\'s refusals', async () => {
    const w = world();
    for (const reader of [null, session(w.stranger)]) {
      const { win, container } = hostPage(reader);
      const refused = await mountDocument(container, { id: w.privatePage }, win).catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(HostShellError);
      expect((refused as HostShellError).code).toBe('not_found');
      expect(container.querySelector('iframe')).toBeNull();
    }
    // A public document mounts signed out, and its sql reads the anonymous view.
    const { win, container } = hostPage(null);
    const mounted = await mountDocument(container, { id: w.publicPage }, win);
    const doc = framedDocument(win, mounted);
    const rows = await doc.fetchThrough(`/api/artifacts/${w.publicPage}/sql`, 'POST', JSON.stringify({ sql: 'select name from people order by name', params: {} }));
    expect(rows.status, JSON.stringify(rows.body)).toBe(200);
    expect(rows.body.rows).toEqual([{ name: 'ada' }, { name: 'bo' }]);
    mounted.destroy();
  });
});

describe('a host page that asks for comments', () => {
  /** A comments module that records what the host module hands it, arriving when `arrive` is called. */
  function commentsModule() {
    const calls: string[] = [];
    let handed: HostCommentsOptions | null = null;
    let arrive!: () => void;
    const comments: HostComments = {
      open: (panel) => { calls.push(`open:${panel ? panel.id : 'overlay'}`); }, close: () => { calls.push('close'); },
      setMode: (mode) => { calls.push(`mode:${mode}`); }, destroy: () => { calls.push('destroy'); },
    };
    const loaded = new Promise<HostCommentsModule>((resolve) => { arrive = () => resolve({ stylesheet: '.sheet{}', mountHostComments: (options) => { handed = options; return comments; } }); });
    return { calls, handed: () => handed, arrive, loadComments: () => loaded };
  }

  it('loads its comments module only when asked, and hands it the bridge, the served head and what the shell asked before it arrived', async () => {
    const w = world();
    const plain = hostPage(session(w.owner));
    const unused = commentsModule();
    let asked = 0;
    const without = await mountDocument(plain.container, { id: w.privatePage }, plain.win, { loadComments: () => { asked++; return unused.loadComments(); } });
    without.openComments(null);
    expect(asked).toBe(0);
    without.destroy();

    const { win, container } = hostPage(session(w.owner));
    const module = commentsModule();
    const mounted = await mountDocument(container, { id: w.privatePage, comments: true, presence: true }, win, { loadComments: module.loadComments });
    const panel = Object.assign(win.document.createElement('aside'), { id: 'panel' });
    // Asked before the module arrives: kept and handed over.
    mounted.setMode('dark');
    mounted.openComments(panel);
    const nonces: string[] = [];
    module.arrive();
    await expect.poll(() => module.handed()).not.toBeNull();
    const handed = module.handed()!;
    expect(handed).toMatchObject({ id: w.privatePage, stylesheet: '.sheet{}', version: 1, mode: 'dark', presence: true, bridge: mounted.bridge, frame: mounted.frame });
    expect(handed.editId).toBeTruthy();
    expect(module.calls).toEqual(['open:panel']);
    handed.onNonce((nonce) => nonces.push(nonce));
    // The frame's controller signs its events: the comments hear its nonce, as the app page's discussion does.
    framedDocument(win, mounted);
    expect(nonces).toEqual(['n'.repeat(16)]);
    expect(handed.nonce()).toBe('n'.repeat(16));
    // Its events go to the shell's container.
    const heard: unknown[] = [];
    container.addEventListener('af-document-comments', (event) => heard.push((event as CustomEvent).detail));
    handed.emit('af-document-comments', { open: 2, unread: 0, panel: true });
    expect(heard).toEqual([{ open: 2, unread: 0, panel: true }]);
    mounted.setMode('light');
    mounted.closeComments();
    mounted.destroy();
    expect(module.calls).toEqual(['open:panel', 'mode:light', 'close', 'destroy']);
  });
});

describe('the host-page guide\'s example', () => {
  it('mounts a document as written, on a host page at the app\'s origin', async () => {
    const w = world();
    const [example] = guideExamples('host-pages', 'A document in a shell on the app\'s origin', 'js', APP);
    expect(example).toMatch(/^import \{ mountDocument \} from '\/af\/host\.js';\n/);
    // The module the example imports is the one this test exercises, at the address it names.
    const served = await app.request(`${APP}/af/host.js`);
    expect(served.status).toBe(200);
    expect(await served.text()).toContain('mountDocument');
    const { win } = hostPage(session(w.owner));
    win.document.body.insertAdjacentHTML('beforeend', '<section id="doc"></section>');
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<void>;
    const body = example!.replace(/^import .*\n/, '');
    const selections: unknown[] = [];
    const logged = { log: (value: unknown) => selections.push(value) };
    const run = new AsyncFunction('mountDocument', 'document', 'documentId', 'console', body);
    await run((container: HTMLElement, options: { id: string }) => mountDocument(container, options, win), win.document, w.privatePage, logged);
    const frame = win.document.querySelector('#doc > iframe') as HTMLIFrameElement;
    expect(new URL(frame.src).origin).toBe(pagesOriginFor(w.privatePage, site));
    // Its selection listener hears the frame's answer to its `select`.
    const posted: Array<{ key: string; payload: { kind: string } }> = [];
    frame.contentWindow!.postMessage = ((message: never) => { posted.push(message); }) as Window['postMessage'];
    const fromFrame = (data: unknown) => win.dispatchEvent(new win.MessageEvent('message', { data, origin: pagesOriginFor(w.privatePage, site), source: frame.contentWindow }));
    fromFrame({ type: STORY_FRAME_BRIDGE_MESSAGE, payload: { kind: 'hello' } });
    const key = posted.find((message) => message.payload.kind === 'attach')!.key;
    fromFrame({ type: STORY_FRAME_BRIDGE_MESSAGE, key, payload: { kind: 'ready', nonce: 'r'.repeat(16) } });
    const commands = posted.filter((message) => message.payload.kind === 'send').map((message) => (message.payload as unknown as { command: { type: string } }).command.type);
    expect(commands).toEqual(['mx:reader-mode', 'mx:select']);
    fromFrame({ type: STORY_FRAME_BRIDGE_MESSAGE, key, payload: { kind: 'event', event: { type: 'mx:selection', nonce: 'r'.repeat(16), selection: { path: 'title' } } } });
    expect(selections).toEqual([{ path: 'title' }]);
  });
});

describe('a host page on another origin', () => {
  it('is refused by the module (the document\'s door refuses it too: lib/html-runtime/__tests__/frame-door-host.test.ts)', async () => {
    const w = world();
    const { win, container } = hostPage(session(w.owner), 'https://shell.other.test');
    const refused = await mountDocument(container, { id: w.privatePage }, win).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(HostShellError);
    expect((refused as HostShellError).code).toBe('wrong_origin');
    expect((refused as Error).message).toContain(APP);
    expect(container.querySelector('iframe')).toBeNull();
  });
});
