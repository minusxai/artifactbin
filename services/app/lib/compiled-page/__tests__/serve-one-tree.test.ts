import { describe, expect, it } from 'vitest';
import { parseJsx } from '@/lib/jsx';
import { compilePage } from '../compiler';
import { loadCompilerBuild } from '../build.server';
import { storyOf } from '../serve.server';
import { LITERALS_ATTR, splitCarriers } from '../carriers';

describe('one-tree snapshot SSR', () => {
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
