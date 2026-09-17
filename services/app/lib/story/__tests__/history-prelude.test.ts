/**
 * The URL bar belongs to us, not to the document.
 *
 * Served TOP-LEVEL, an author's script shares a browsing context with the URL
 * the reader is looking at — so `history.replaceState` could paint any path
 * under our host over a page the author controls entirely. The prelude
 * overrides and FREEZES the History API before the author's script runs, which
 * holds inside the sandbox: the usual escape (borrow a pristine prototype from
 * a fresh `about:blank` realm) fails there, because a child frame inherits the
 * sandbox and gets its OWN opaque origin, making it cross-origin to its parent.
 *
 * What this cannot stop is navigation: `location` is [LegacyUnforgeable], so
 * every property is non-configurable and nothing can shadow it. That is a
 * known, accepted limit — the prelude is about the URL BAR LYING, not about
 * where a click may take you.
 *
 * (The live proof that the freeze survives a real browser is in
 * scripts/gate-secure-arch.mjs; this pins that the code is actually shipped,
 * before the author's script, and only where it can matter.)
 */
import { describe, expect, it } from 'vitest';
import { buildStoryDocument, HISTORY_PRELUDE } from '@/lib/story/document';

const build = (source: string) => buildStoryDocument({
  source, compiledCss: null, theme: null, colorMode: null, refData: {}, title: 'T', runtimeSrc: '/story/entry-TESTHASH.js',
});

describe('the history prelude', () => {
  it('ships in every served document', async () => {
    const html = await build('<h1>plain</h1>');
    expect(html).toContain(HISTORY_PRELUDE);
  });

  it('freezes both the instance and the prototype, so neither can be put back', () => {
    expect(HISTORY_PRELUDE).toContain('History.prototype');
    expect(HISTORY_PRELUDE).toContain('Object.freeze');
    for (const method of ['pushState', 'replaceState']) expect(HISTORY_PRELUDE).toContain(method);
  });

  it('runs BEFORE the author script — after it, the override is just a suggestion', async () => {
    const html = await build('<Helmet><script>{`history.replaceState(null,"","/spoof")`}</script></Helmet><h1>hi</h1>');
    expect(html).toContain('/spoof'); // the author script really is in there
    expect(html.indexOf(HISTORY_PRELUDE)).toBeLessThan(html.indexOf('/spoof'));
  });

  it('is inert for the document itself — our own runtime never touches history', async () => {
    // If the runtime ever did, freezing would break the deck rail rather than
    // an attacker, and this test is where that would be noticed.
    const runtime = await import('node:fs').then((fs) => fs.readFileSync('lib/story-runtime/dist/story-ssr.cjs', 'utf8'));
    expect(/\bhistory\.(pushState|replaceState)\b/.test(runtime)).toBe(false);
  });
});

/*
 * SPIKE S2 (F2 — `<Value>` selections in the URL, risk R5).
 *
 * The freeze above is what makes a served document's URL bar trustworthy, and
 * F2 needs the URL to change anyway: a reader who picks "west" should be able
 * to copy the address bar and hand someone that document. So the prelude keeps
 * every door shut and opens ONE window: a function bound to the NATIVE
 * `replaceState` before the overwrite, exposed as a frozen, non-writable own
 * property of `window`, which can rewrite `$`-prefixed query params on the
 * CURRENT pathname and nothing else.
 *
 * Narrow by CONSTRUCTION rather than by escaping: there is no argument for a
 * path, a host or a hash; `location.pathname`/`location.hash` are read fresh
 * at call time; a key that is not a plain identifier is dropped rather than
 * encoded; and the search is rebuilt with `URLSearchParams`, so a crafted
 * `toString` on a value produces an encoded VALUE and can reach nothing else.
 */
import { JSDOM } from 'jsdom';

const START = 'http://localhost:3030/@sree/reports/AbC123-q3';

/** A fresh realm with the prelude already run — the document's own situation. */
const realm = (url = START) => {
  const dom = new JSDOM('<!doctype html><body><p>doc</p></body>', { url, runScripts: 'dangerously' });
  dom.window.eval(HISTORY_PRELUDE);
  return dom.window as unknown as Window & {
    __mxValues?: (v: Record<string, unknown>) => void;
    eval(code: string): unknown;
  };
};

describe('the narrow URL capability the prelude exposes (spike S2)', () => {
  it('still leaves history.replaceState inert — the freeze is unchanged', () => {
    const w = realm();
    w.eval('history.replaceState(null,"","/evil")');
    w.eval('history.pushState(null,"","/evil2")');
    expect(w.location.href).toBe(START);
  });

  it('still freezes the prototype, so the native cannot be put back', () => {
    const w = realm();
    expect(w.eval('Object.isFrozen(History.prototype)')).toBe(true);
    w.eval('try{History.prototype.replaceState=function(){location.pathname="/evil"}}catch(e){}');
    w.eval('history.replaceState(null,"","/evil")');
    expect(w.location.href).toBe(START);
  });

  it('writes a $ param on the current path and leaves pathname and hash alone', () => {
    const w = realm(`${START}#section-2`);
    w.__mxValues!({ season: '2024-25' });
    expect(w.location.pathname).toBe('/@sree/reports/AbC123-q3');
    expect(w.location.search).toBe('?$season=2024-25');
    expect(w.location.hash).toBe('#section-2');
  });

  it('removes a $ param when the value is null or undefined', () => {
    const w = realm();
    w.__mxValues!({ season: '2024-25', region: 'west' });
    expect(w.location.search).toContain('season=2024-25');
    w.__mxValues!({ season: null });
    expect(w.location.search).not.toContain('season');
    expect(w.location.search).toContain('region=west');
    w.__mxValues!({ region: undefined });
    expect(w.location.search).toBe('');
  });

  it('leaves every param that is not ours untouched', () => {
    const w = realm(`${START}?ref=2`);
    w.__mxValues!({ season: '2024-25' });
    expect(new URLSearchParams(w.location.search).get('ref')).toBe('2');
    w.__mxValues!({ season: null });
    expect(new URLSearchParams(w.location.search).get('ref')).toBe('2');
  });

  it('cannot be reassigned or deleted, and fails silently in sloppy mode', () => {
    const w = realm();
    const before = w.__mxValues;
    w.eval('try{window.__mxValues=function(){location.pathname="/evil"}}catch(e){}');
    expect(w.__mxValues).toBe(before);
    expect(w.eval('(function(){try{return delete window.__mxValues}catch(e){return "threw"}})()')).toBe(false);
    expect(w.__mxValues).toBe(before);
    expect(w.eval('Object.isFrozen(window.__mxValues)')).toBe(true);
  });

  it('takes no path, host or hash — a crafted value is encoded, never smuggled', () => {
    const w = realm(`${START}#keep`);
    w.eval(`window.__mxValues({ season: { toString: function(){ return "x#/evil?a=b&c=d" } } })`);
    expect(w.location.pathname).toBe('/@sree/reports/AbC123-q3');
    expect(w.location.hash).toBe('#keep');
    expect(w.location.host).toBe('localhost:3030');
    expect(new URLSearchParams(w.location.search).get('$season')).toBe('x#/evil?a=b&c=d');
    expect([...new URLSearchParams(w.location.search).keys()]).toEqual(['$season']);
  });

  it('ignores a key that is not a plain value name', () => {
    const w = realm();
    w.eval('window.__mxValues({ "a&b=c": "x", "../evil": "y", "__proto__": "z", "ok": "1" })');
    expect([...new URLSearchParams(w.location.search).keys()]).toEqual(['$ok']);
  });

  it('reads only the object\'s own enumerable keys, so a polluted prototype injects nothing', () => {
    const w = realm();
    w.eval('Object.prototype.injected = "1"; try{ window.__mxValues({ ok: "1" }) } finally { delete Object.prototype.injected }');
    expect([...new URLSearchParams(w.location.search).keys()]).toEqual(['$ok']);
  });

  it('survives a non-object argument, a throwing getter and a symbol value', () => {
    const w = realm();
    w.eval('window.__mxValues(null); window.__mxValues("nope"); window.__mxValues();');
    expect(w.location.href).toBe(START);
    w.eval('window.__mxValues(Object.defineProperty({ ok: "1" }, "bad", { enumerable: true, get(){ throw new Error("x") } }))');
    expect(w.location.href).toBe(START); // one bad key aborts the whole rewrite, loudly to nobody
    w.eval('window.__mxValues({ ok: Symbol("s") })');
    expect(w.location.href).toBe(START);
  });

  it('reveals nothing exploitable in its source — no captured path, no second verb', () => {
    const w = realm();
    const src = String(w.eval('String(window.__mxValues)'));
    expect(src).not.toContain('pushState');
    expect(/History\s*\.\s*prototype/.test(src)).toBe(false);
    // The native it holds is a CLOSURE variable; toString cannot hand it out.
    expect(w.eval('typeof window.__mxValues.caller')).not.toBe('function');
  });

  it('is shipped in the served document, before the author script', async () => {
    const html = await build('<Helmet><script>{`window.__mxValues({a:"1"})`}</script></Helmet><h1>hi</h1>');
    expect(html).toContain('__mxValues');
    expect(html.indexOf(HISTORY_PRELUDE)).toBeLessThan(html.indexOf('window.__mxValues({a:"1"})'));
  });
});

/*
 * The ordering the capability is built in, pinned on its own.
 *
 * The whole prelude is one fail-silent `try`, so anything attempted IN FRONT
 * of the freeze can take the freeze down with it and leave the document with a
 * fully writable History API and nobody told. Only the `bind` has to precede
 * the overwrite; everything else follows the freeze.
 */
describe('the freeze is never behind the capability (spike S2)', () => {
  it('shuts every door even when defining the capability throws', () => {
    const dom = new JSDOM('<!doctype html><body><p>doc</p></body>', { url: START, runScripts: 'dangerously' });
    // Something already owns the name, non-configurably: the prelude's own
    // `defineProperty` must throw here.
    dom.window.eval('Object.defineProperty(window,"__mxValues",{value:1,configurable:false,writable:false})');
    dom.window.eval(HISTORY_PRELUDE);
    const w = dom.window as unknown as Window & { eval(code: string): unknown };
    expect(w.eval('Object.isFrozen(History.prototype)')).toBe(true);
    expect(w.eval('Object.isFrozen(history)')).toBe(true);
    w.eval('history.replaceState(null,"","/evil");history.pushState(null,"","/evil2")');
    expect(w.location.href).toBe(START);
    expect(w.eval('typeof window.__mxValues')).toBe('number'); // the capability lost, the freeze held
  });
});
