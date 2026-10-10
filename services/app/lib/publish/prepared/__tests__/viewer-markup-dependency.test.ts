import { describe, expect, it } from 'vitest';
import { compilePage } from '@/lib/compiled-page/compiler';
import { loadCompilerBuild } from '@/lib/compiled-page/build.server';
import { doorsFor } from '../serve.server';
import { wantsViewerOverlay } from '@/lib/islands/viewer';
import { prepareStoryParts } from '@/lib/publish/prepared/prepare-runtime.server';
import { compileDataflow, prepareCompile } from '@/lib/dataflow/compile-dataflow';
import { dataflowOf, splitHelmet } from '@/lib/document/helmet';
import { parseJsx } from '@/lib/jsx';
import type { IslandPageData } from '@/lib/islands/contract';
import type { CompileInput } from '@/lib/compiled-page/contract';

async function inputOf(source: string): Promise<CompileInput> {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error(parsed.error);
  const { content, body } = splitHelmet(parsed.nodes);
  const declared = dataflowOf(content);
  const prepared = await prepareCompile(declared, async () => null);
  const result = compileDataflow(declared, prepared, body);
  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
  const { runtime } = await prepareStoryParts({
    source,
    compiledCss: null,
    theme: null,
    colorMode: 'light',
    title: 'Viewer identity dependency',
    refData: {},
    assetUrls: new Set(),
  });
  return {
    nodes: runtime.data.nodes,
    colorMode: 'light',
    template: null,
    chrome: true,
    glyphs: runtime.data.glyphs,
    refData: {},
    flow: declared.imports.length || declared.values.length || declared.queries.length ? result.compiled : null,
    build: loadCompilerBuild().id,
  };
}

describe('compiled viewer identity dependencies', () => {
  it('records $_me used by authored JSX conditions without requiring an SQL reader', async () => {
    const input = await inputOf('<Helmet><Query name="total">{`select 1 as n`}</Query></Helmet><main>{$_me.id ? <p>Owner controls</p> : <SignIn>Sign in to add tasks</SignIn>}</main>');
    const compiled = await compilePage(input, loadCompilerBuild());
    const doors = { queryUrl: '/a/abc/query', assetsUrl: '/a/abc/assets', viewerUrl: '/a/abc/viewer' };

    expect(compiled.plan?.queries).toMatchObject([{ name: 'total', scope: 'shared', reads: { builtins: [] } }]);
    expect(compiled.readsViewerMarkup).toBe(true);
    expect(doorsFor(compiled, doors)).toEqual(doors);
    expect(wantsViewerOverlay({ signedIn: true, viewerUrl: doors.viewerUrl } as IslandPageData, input.flow)).toBe(true);
    // The viewer door is available for an identity-dependent condition, but a guest does not ask it.
    expect(wantsViewerOverlay({ signedIn: false, viewerUrl: doors.viewerUrl } as IslandPageData, input.flow)).toBe(false);
  });

  it('leaves ordinary markup independent of reader identity', async () => {
    const input = await inputOf('<main><p>Public content</p></main>');
    const compiled = await compilePage(input, loadCompilerBuild());
    const doors = { queryUrl: '/a/abc/query', assetsUrl: '/a/abc/assets', viewerUrl: '/a/abc/viewer' };

    expect(compiled.readsViewerMarkup).toBe(false);
    expect(doorsFor(compiled, doors)).toEqual({ queryUrl: doors.queryUrl, assetsUrl: doors.assetsUrl });
  });

  it('keeps the viewer door for a legacy compile with no markup-dependency metadata until upgrade', async () => {
    const input = await inputOf('<Helmet><Query name="total">{`select 1 as n`}</Query></Helmet><main>{$_me.id ? <p>Owner controls</p> : <SignIn>Sign in to add tasks</SignIn>}</main>');
    const compiled = await compilePage(input, loadCompilerBuild());
    const legacy = { ...compiled };
    delete legacy.readsViewerMarkup;
    const doors = { queryUrl: '/a/abc/query', assetsUrl: '/a/abc/assets', viewerUrl: '/a/abc/viewer' };

    expect(compiled.readsViewerMarkup).toBe(true);
    const legacyDoors = doorsFor(legacy, doors);
    expect(legacyDoors).toEqual(doors);
    expect(wantsViewerOverlay({ signedIn: true, viewerUrl: legacyDoors?.viewerUrl } as IslandPageData, input.flow)).toBe(true);
    expect(wantsViewerOverlay({ signedIn: false, viewerUrl: legacyDoors?.viewerUrl } as IslandPageData, input.flow)).toBe(false);
  });
});
