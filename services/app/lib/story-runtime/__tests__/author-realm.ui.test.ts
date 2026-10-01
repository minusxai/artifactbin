/**
 * THE AUTHOR REALM (lib/story-runtime/author-realm): the version's script in a QuickJS interpreter on
 * this thread, over the real store and a real (jsdom) story root. What has to be true: the data API
 * round-trips through JSON, the page API reaches only the story root and refuses what the policy
 * refuses, author code sees no host global, a runaway script ends the realm without touching the page,
 * and teardown leaves nothing behind. The interpreter is the shipped wasm, read from the package.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EMPTY_COMPILED_DATAFLOW } from '@/lib/story/data/compiled-dataflow';
import { createDataflowStore, type DataflowStore } from '../store';
import { compileRealmWasm, newRealmModule, type RealmWasm } from '../author-realm/module';
import { createAuthorRealm, type AuthorRealm } from '../author-realm/realm';
import { AUTHOR_NODE_ATTR } from '../author-realm/dom-host';

let wasm: RealmWasm;
beforeAll(async () => {
  wasm = await compileRealmWasm(readFileSync(path.resolve(process.env.APP_PACKAGE_ROOT!, '../../node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm')));
});

const flow = { ...EMPTY_COMPILED_DATAFLOW, values: [
  { kind: 'scalar' as const, name: 'count', type: 'number' as const, default: 0 },
  { kind: 'scalar' as const, name: 'label', type: 'string' as const, default: 'none' },
] };
let store: DataflowStore;
let realm: AuthorRealm | null = null;
let errors: string[] = [];
const logs: string[][] = [];
const fakeConsole = { log: (...a: unknown[]) => { logs.push(a.map(String)); }, info: () => {}, warn: () => {}, error: (...a: unknown[]) => { logs.push(a.map(String)); } };

const page = () => {
  document.body.innerHTML = '<div data-mx-inline-story="" id="mx-story-root">'
    + '<h1 id="heading">Hello</h1><p id="lede" class="lede">before</p>'
    + '<input id="name" value="x"><select id="pick"><option value="a">a</option><option value="b">b</option></select>'
    + '<div data-hk="s0-0" id="island"><i id="island-text">West</i></div>'
    + '<div data-mx-managed-frame=""><div id="inside-frame">frame</div></div>'
    + '</div><p id="outside">outside</p>';
  return document.getElementById('mx-story-root') as HTMLElement;
};
async function run(source: string): Promise<AuthorRealm> {
  const root = page();
  errors = [];
  store = createDataflowStore({ flow });
  realm = createAuthorRealm({ module: await newRealmModule(wasm), source, store, root, doc: document, onError: (m) => errors.push(m), console: fakeConsole });
  await realm.settled();
  return realm;
}
afterEach(() => { realm?.dispose(); realm = null; store?.dispose(); document.body.replaceChildren(); vi.useRealTimers(); });

describe('the author realm', () => {
  it('runs the script over the document data: set, read, describe, and the window alias', async () => {
    await run(`
      const before = await mx.read(['count']);
      await window.mx.set({ count: before.signals.count.value + 5, label: 'five' });
      const after = await mx.read(['count', 'label']);
      const described = await mx.describe();
      dom.setText(dom.query('#lede'), after.signals.count.value + ':' + after.signals.label.value + ':' + described.signals.map(s => s.name).join(','));
    `);
    await vi.waitFor(() => expect(document.getElementById('lede')!.textContent).toBe('5:five:count,label'));
    expect(store.getState().values.count).toBe(5);
    expect(errors).toEqual([]);
  });

  it('reaches only the story root, writes text and form values, creates marked elements and hears events', async () => {
    await run(`
      const heading = dom.query('#heading');
      dom.setText(heading, 'Changed');
      const list = dom.create('ul'); const item = dom.create('li', 'one'); dom.append(list, item); dom.append(dom.query('#mx-story-root'), list);
      dom.setAttr(item, 'data-kind', 'row'); dom.addClass(item, 'mt-2', '@2xl:px-8');
      dom.setValue(dom.query('#name'), 'typed'); dom.setValue(dom.query('#pick'), 'b');
      dom.on(heading, 'click', (event) => { dom.setText(heading, 'clicked:' + event.type + ':' + (event.target === heading)); });
      dom.on(dom.query('#name'), 'input', (event) => { dom.setText(dom.query('#lede'), 'input:' + event.value); });
      dom.setText(dom.query('#lede'), String(dom.query('#outside')) + '/' + String(dom.query('#inside-frame')) + '/' + dom.queryAll('li').length);
    `);
    expect(errors).toEqual([]);
    expect(document.getElementById('heading')!.textContent).toBe('Changed');
    const li = document.querySelector('li')!;
    expect(li.hasAttribute(AUTHOR_NODE_ATTR)).toBe(true);
    expect(li.getAttribute('data-kind')).toBe('row');
    expect(li.className).toBe('mt-2 @2xl:px-8');
    expect((document.getElementById('name') as HTMLInputElement).value).toBe('typed');
    expect((document.getElementById('pick') as HTMLSelectElement).value).toBe('b');
    // Nothing outside the root, nothing inside a managed frame, and queryAll counts what the script made.
    expect(document.getElementById('lede')!.textContent).toBe('null/null/1');
    document.getElementById('heading')!.click();
    await vi.waitFor(() => expect(document.getElementById('heading')!.textContent).toBe('clicked:click:true'));
    const input = document.getElementById('name') as HTMLInputElement;
    input.value = 'more'; input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(document.getElementById('lede')!.textContent).toBe('input:more'));
    expect(errors).toEqual([]);
  });

  it('refuses what the attribute policy refuses, attributes on the page\'s own elements, and text an island owns', async () => {
    await run(`
      const codes = [];
      const attempt = (fn) => { try { fn(); codes.push('ok'); } catch (e) { codes.push(e.code); } };
      const link = dom.create('a', 'go');
      attempt(() => dom.setAttr(link, 'href', 'javascript:alert(1)'));
      attempt(() => dom.setAttr(link, 'onclick', 'x'));
      attempt(() => dom.setAttr(link, 'id', 'x'));
      attempt(() => dom.setAttr(link, 'data-mx-ast', 'x'));
      attempt(() => dom.setAttr(link, 'href', '#top'));
      attempt(() => dom.setAttr(dom.query('#heading'), 'title', 'x'));
      attempt(() => dom.addClass(dom.query('#heading'), 'mx-doc'));
      attempt(() => dom.setText(dom.query('#island-text'), 'East'));
      attempt(() => dom.create('script'));
      attempt(() => dom.create('img'));
      attempt(() => dom.on(dom.query('#heading'), 'mouseover', () => {}));
      attempt(() => dom.remove(dom.query('#heading')));
      dom.setText(dom.query('#lede'), codes.join(' '));
    `);
    expect(document.getElementById('lede')!.textContent).toBe('INVALID_ATTRIBUTE INVALID_ATTRIBUTE INVALID_ATTRIBUTE INVALID_ATTRIBUTE ok PAGE_OWNED INVALID_CLASS ISLAND_OWNED INVALID_TAG INVALID_TAG INVALID_EVENT PAGE_OWNED');
    expect(document.getElementById('island-text')!.textContent).toBe('West');
    expect(document.getElementById('heading')!.isConnected).toBe(true);
  });

  it('shows author code no host global, and a prototype-polluting payload reaches neither the store nor the host', async () => {
    await run(`
      const names = Object.getOwnPropertyNames(globalThis).filter(n => !/^[A-Z]/.test(n) && !['globalThis','undefined','NaN','Infinity','parseInt','parseFloat','isNaN','isFinite','decodeURI','decodeURIComponent','encodeURI','encodeURIComponent','escape','unescape','eval','queueMicrotask','performance'].includes(n)).sort();
      const absent = ['fetch','document','XMLHttpRequest','WebAssembly','top','parent','localStorage','location','navigator','Function.prototype.constructor'].map(n => typeof globalThis[n]);
      let polluted = 'no';
      try { await mx.set(JSON.parse('{"__proto__":{"polluted":1},"count":1}')); } catch (e) { polluted = e.code; }
      dom.setText(dom.query('#lede'), names.join(',') + '|' + absent.join(',') + '|' + polluted + '|' + (Function('return this')() === globalThis));
    `);
    await vi.waitFor(() => expect(document.getElementById('lede')!.textContent).toMatch(/\|/));
    const [names, absent, polluted, sameGlobal] = document.getElementById('lede')!.textContent!.split('|');
    expect(names).toBe('clearTimeout,console,dom,mx,self,setTimeout,window');
    expect(absent!.split(',').every((t) => t === 'undefined')).toBe(true);
    // The reviver drops the `__proto__` key before the store sees the patch; the honest key lands.
    expect(polluted).toBe('no');
    expect(sameGlobal).toBe('true');
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    expect(store.getState().values.count).toBe(1);
  });

  it('ends a runaway loop and an oversized allocation without touching the page, and reports the budget', async () => {
    const looped = await run(`dom.setText(dom.query('#lede'), 'started'); while (true) {}`);
    expect(document.getElementById('lede')!.textContent).toBe('started');
    expect(errors.some((e) => /time budget/.test(e))).toBe(true);
    await vi.waitFor(() => expect(looped.disposed).toBe(true));
    const stormed = await run(`const a = new Array(1e8).fill(1); dom.setText(dom.query('#lede'), String(a.length));`);
    expect(document.getElementById('lede')!.textContent).toBe('before');
    expect(errors.some((e) => /memory budget|script: InternalError/.test(e))).toBe(true);
    await vi.waitFor(() => expect(stormed.disposed).toBe(true));
  });

  it('reports a rejected script and a failing handler, keeps running after the handler, and logs through the host console', async () => {
    await run(`
      console.log('hello', {a: 1});
      dom.on(dom.query('#heading'), 'click', () => { throw new Error('boom'); });
      dom.on(dom.query('#heading'), 'click', () => { dom.setText(dom.query('#lede'), 'still here'); });
      throw new Error('top-level');
    `);
    expect(errors).toEqual(['script: Error: top-level']);
    expect(logs).toContainEqual(['[artifact script]', 'hello', '{"a":1}']);
    document.getElementById('heading')!.click();
    await vi.waitFor(() => expect(document.getElementById('lede')!.textContent).toBe('still here'));
    expect(errors).toEqual(['script: Error: top-level', 'event handler: Error: boom']);
    expect(realm!.disposed).toBe(false);
  });

  it('delivers subscriptions and timers, and disposing stops them, removes created elements and listeners', async () => {
    vi.useFakeTimers();
    const live = await run(`
      let seen = 0;
      const stop = mx.subscribe(['count'], (snapshot) => { seen++; dom.setText(dom.query('#lede'), 'count=' + snapshot.signals.count.value + ' seen=' + seen); });
      dom.append(dom.query('#mx-story-root'), dom.create('section', 'made'));
      dom.on(dom.query('#heading'), 'click', () => dom.setText(dom.query('#heading'), 'late click'));
      setTimeout(() => dom.setText(dom.query('#heading'), 'timer fired'), 50);
    `);
    expect(errors).toEqual([]);
    await vi.advanceTimersByTimeAsync(10);
    expect(document.getElementById('lede')!.textContent).toBe('count=0 seen=1');
    store.setValue('count', 3);
    await vi.advanceTimersByTimeAsync(10);
    expect(document.getElementById('lede')!.textContent).toBe('count=3 seen=2');
    await vi.advanceTimersByTimeAsync(60);
    expect(document.getElementById('heading')!.textContent).toBe('timer fired');
    expect(document.querySelector('section')).not.toBeNull();
    live.dispose();
    live.dispose();
    expect(live.disposed).toBe(true);
    expect(document.querySelector('section')).toBeNull();
    store.setValue('count', 4);
    document.getElementById('heading')!.click();
    await vi.advanceTimersByTimeAsync(20);
    expect(document.getElementById('lede')!.textContent).toBe('count=3 seen=2');
    expect(document.getElementById('heading')!.textContent).toBe('timer fired');
    expect(errors).toEqual([]);
  });
});
