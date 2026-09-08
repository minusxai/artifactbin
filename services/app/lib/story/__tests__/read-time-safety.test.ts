import { describe, expect, it } from 'vitest';
import { storyBodyFor } from '../body';
import { buildStoryDocument } from '../document';
import { storyUpdateParts } from '../update-parts';

const documentFor = (source: string) => buildStoryDocument({
  source,
  compiledCss: null,
  theme: null,
  colorMode: null,
  refData: {},
  title: 'Stored title',
  runtimeSrc: null,
});

/** Stored rows are untrusted, including rows predating today's publish gate.
 * The same reader feeds SSR, client bootstrap and live replacements. */
describe('stored markup safety at the shared rendering boundary', () => {
  it.each([
    '<script>window.legacyExecuted=true</script><p>Legacy</p>',
    '<img src="x" onError="alert(1)" />',
    '<a href="javascript:alert(1)">Open</a>',
    '<iframe srcDoc="hello" />',
    '<div dangerouslySetInnerHTML={{ __html: "<script>alert(1)</script>" }} />',
    '<Helmet><meta http-equiv="refresh" content="0;url=https://example.org" /></Helmet><p>Text</p>',
  ])('refuses unsafe historical source: %s', (source) => {
    expect(storyBodyFor(source)).toBeNull();
  });

  it('retains valid prose and persistent node IDs', () => {
    const result = storyBodyFor('<section id="section1"><p id="paragraph1">Safe</p></section>');
    expect(result).not.toBeNull();
    expect(JSON.stringify(result?.body)).toContain('paragraph1');
  });

  it('keeps a valid author script inert in the Helmet payload', () => {
    const result = storyBodyFor('<Helmet><script>{`mx.params.set("ready", true);`}</script></Helmet><p>Safe</p>');
    expect(result?.content.script).toBe('mx.params.set("ready", true);');
    expect(result?.body.some(n => n.type === 'element' && n.tag === 'script')).toBe(false);
  });

  it('escapes an invalid stored document instead of rendering or executing it', async () => {
    const source = '<script>window.legacyExecuted=true</script><p>Legacy</p>';
    const html = await documentFor(source);
    expect(html).toContain('&lt;script&gt;window.legacyExecuted=true&lt;/script&gt;');
    expect(html).not.toContain('<script>window.legacyExecuted=true</script>');
    expect(html).not.toContain('<p>Legacy</p>');
  });

  it('refuses an invalid live replacement through the same seam', () => {
    expect(storyUpdateParts('<img src="x" onError="alert(1)" />')).toBeNull();
  });

  it('retains a valid managed Iframe in documents and live replacements', async () => {
    const source = '<Iframe id="frame1" title="Demo" height={320}><canvas id="canvas1" /><script>{`document.querySelector("canvas")`}</script></Iframe>';
    const parts = storyUpdateParts(source);
    expect(parts?.nodes[0]).toMatchObject({ type: 'element', tag: 'Iframe', isComponent: true });
    expect(await documentFor(source)).toContain('id="frame1" data-mx-ast="0" aria-label="Demo"');
  });
});
