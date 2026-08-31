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
