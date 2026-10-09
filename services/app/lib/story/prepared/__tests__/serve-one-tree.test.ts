import { describe, expect, it } from 'vitest';
import { parseJsx } from '@/lib/jsx';
import { compilePage } from '../compiler';
import { loadCompilerBuild } from '../build.server';
import { storyOf, withoutDeckChrome } from '../serve.server';
import { LITERALS_ATTR, splitCarriers } from '../carriers';

describe('one-tree snapshot SSR', () => {
  it('hides bare deck controls without removing the compiled hydration tree or immutable carriers', () => {
    const column = '<div class="mx-doc"><div data-hk="d-00040"><section>Slide with a chart</section></div></div>';
    const carrier = '<script type="application/json" data-mx-island-literals="0123456789abcdef">["literal"]</script>';
    const story = '<div class="mx-deck"><nav class="mx-rail"><button>Slide one</button></nav>' + column + '<div class="mx-present" aria-label="Slide controls"><button>Present</button></div></div>' + carrier;
    const bare = withoutDeckChrome(story);
    expect(bare).toContain('<div class="mx-deck">');
    expect(bare).toContain('<nav class="mx-rail" hidden style="display:none">');
    expect(bare).toContain('<div class="mx-present" aria-label="Slide controls" hidden style="display:none">');
    expect(bare).toContain(column);
    expect(bare.endsWith(carrier)).toBe(true);
    expect(withoutDeckChrome(column + carrier)).toBe(column + carrier);
  });

  it('carries the browser literal data from the stored compile into a dynamic server render', async () => {
    const parsed = parseJsx('<Tabs defaultValue="one"><TabsList><TabsTrigger value="one">One</TabsTrigger></TabsList><TabsContent value="one"><p>Static panel</p></TabsContent></Tabs>');
    if (!parsed.ok) throw new Error(parsed.error);
    const build = loadCompilerBuild();
    const compiled = await compilePage({ nodes: parsed.nodes, colorMode: 'light', template: null, chrome: false, refData: {}, flow: null, build: build.id }, build);
    const story = await storyOf(compiled, { values: { unused: 'non-default' }, results: null, mermaidImages: {}, drawings: {}, resultsId: null });
    const carrier = compiled.html.match(/<script type="application\/json" data-mx-island-literals="[0-9a-f]{16}">[\s\S]*?<\/script>/)?.[0];
    expect(carrier).toBeTruthy();
    expect(story).toContain(carrier);
  });

  it('serves the stored html verbatim for plain input on its own half, and keeps the stored carriers once on a re-render', async () => {
    const parsed = parseJsx('<Tabs defaultValue="one"><TabsList><TabsTrigger value="one">One</TabsTrigger></TabsList><TabsContent value="one"><p>Static panel</p></TabsContent></Tabs>');
    if (!parsed.ok) throw new Error(parsed.error);
    const build = loadCompilerBuild();
    const compiled = await compilePage({ nodes: parsed.nodes, colorMode: 'light', template: null, chrome: false, refData: {}, flow: null, build: build.id }, build);
    const plain = { values: {}, results: null, mermaidImages: {}, drawings: {}, resultsId: null };
    expect(await storyOf(compiled, { ...plain, build })).toBe(compiled.html);
    const { literals } = splitCarriers(compiled.html);
    expect(literals).toBeTruthy();
    const dynamic = await storyOf(compiled, { ...plain, values: { unused: 'other' } });
    expect(dynamic.split(literals)).toHaveLength(2);
    expect(splitCarriers(dynamic).story).not.toContain(LITERALS_ATTR);
  });
});
