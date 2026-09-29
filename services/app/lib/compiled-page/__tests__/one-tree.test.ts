import { describe, expect, it } from 'vitest';
import { parseJsx } from '@/lib/jsx';
import { generate } from '../compiler';
import { buildDocumentModules } from '../bundle.server';
import { loadCompilerBuild } from '../build.server';
import { createModuleStore } from '../modules.server';

const input = (source: string) => ({
  nodes: (() => { const parsed = parseJsx(source); if (!parsed.ok) throw new Error(parsed.error); return parsed.nodes; })(),
  colorMode: 'light' as const,
  template: null,
  chrome: false,
  refData: {},
  flow: null,
});

describe('one document tree', () => {
  it('emits static siblings as empty NoHydration placeholders in the browser tree', () => {
    const result = generate(input('<h1 id="heading">Server prose</h1><Tabs defaultValue="one"><TabsList><TabsTrigger value="one">One</TabsTrigger></TabsList><TabsContent value="one"><p id="panel-prose">Panel prose</p><Switch label="Live" /></TabsContent></Tabs><footer id="end">End prose</footer>'));
    expect(result.skeleton).toContain('NoHydration');
    expect(result.skeleton).toContain('Server prose');
    expect(result.skeleton).toContain('Panel prose');
    expect(result.browserIslands).toContain('NoHydration');
    expect(result.browserIslands).not.toContain('Server prose');
    expect(result.browserIslands).not.toContain('Panel prose');
    expect(result.browserIslands).toContain('Switch');
    expect(result.skeleton).not.toContain('mx-slot');
    expect(result.browserIslands).not.toContain('ISLANDS = [');
  });

  it('renders the complete story once and ships no static prose in the browser module', async () => {
    const source = '<h1 id="heading">Server prose</h1><Tabs defaultValue="one"><TabsList><TabsTrigger value="one">One</TabsTrigger></TabsList><TabsContent value="one"><p id="panel-prose">Panel prose</p><Switch label="Live" /></TabsContent></Tabs>';
    const store = createModuleStore();
    const built = await buildDocumentModules(generate(input(source)), { build: loadCompilerBuild(), flow: null, values: {}, store });
    expect(built.html).toContain('Server prose');
    expect(built.html).toContain('Panel prose');
    expect(built.html).not.toContain('mx-slot');
    expect(built.ssr).not.toBeNull();
    const browser = new TextDecoder().decode((await store.get(built.module!.sha))!);
    expect(browser).not.toContain('Server prose');
    expect(browser).not.toContain('Panel prose');
    expect(browser).not.toContain('templateFromPage');
    expect(built.templateBrBytes).toBeNull();
  });
});
