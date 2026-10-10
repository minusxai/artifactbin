import { describe, expect, it } from 'vitest';
import { prepareStoryRuntime, readerIslandData, type PrepareStoryInput } from '../prepared/prepare-runtime.server';
import { loadCompilerBuild } from '@/lib/compiled-page/build.server';
import { EMPTY_COMPILED_DATAFLOW } from '@/lib/dataflow/compiled-dataflow';

const input = (source: string): PrepareStoryInput => ({ source, compiledCss: null, theme: null, colorMode: 'light', refData: {}, title: 'Stored title' });

describe('shared story preparation', () => {
  it('gives the inline reader the island-built SQLite wasm for local page queries', () => {
    const data = readerIslandData({ refData: {}, dataflow: { flow: EMPTY_COMPILED_DATAFLOW, hold: [] } });
    expect(data.sqliteWasm).toBe(loadCompilerBuild().sqliteWasm);
    expect(readerIslandData({ refData: {} }).sqliteWasm).toBeUndefined();
  });
  it('separates author code from top-level rendered nodes and honors the document title', async () => {
    const prepared = await prepareStoryRuntime(input('<Helmet><title>Document title</title><script>{`globalThis.probe = true`}</script></Helmet><h1 id="heading">Read me</h1>'));
    expect(prepared.title).toBe('Document title');
    // The script rides as the module built at publish (author-module.server): the author's statement, as a module.
    expect(prepared.authorScript).toContain('globalThis.probe = true');
    expect(prepared.data.nodes).toHaveLength(1);
    expect(prepared.data.nodes[0]).toMatchObject({ type: 'element', tag: 'h1' });
    expect(JSON.stringify(prepared.data.nodes)).not.toContain('globalThis.probe');
  });

  it('preserves persistent body identity and separates replaceable CSS from base styles', async () => {
    const prepared = await prepareStoryRuntime({ ...input('<Helmet><style>{`p { color: red }`}</style></Helmet><p id="retained">Content</p>'), compiledCss: '.font-bold{font-weight:700}' });
    expect(prepared.compiledCss).toContain('font-weight:700');
    expect(prepared.authorCss).toContain('color: red');
    expect(prepared.baseCss.length).toBeGreaterThan(0);
    expect(JSON.stringify(prepared.data.nodes)).toContain('retained');
    expect(prepared.authorScript).toBeNull();
  });
});
