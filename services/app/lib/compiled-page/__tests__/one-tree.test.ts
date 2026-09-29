import { describe, expect, it } from 'vitest';
import { parseJsx } from '@/lib/jsx';
import { generate } from '../compiler';
import { buildDocumentModules } from '../bundle.server';
import { loadCompilerBuild } from '../build.server';
import { createModuleStore } from '../modules.server';
import { JSDOM } from 'jsdom';

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

  it('serves static descendants inside closed disclosure and floating content', async () => {
    const source = '<Accordion collapsible><AccordionItem value="one"><AccordionTrigger>Accordion</AccordionTrigger><AccordionContent><p id="accordion-prose">Accordion prose</p></AccordionContent></AccordionItem></Accordion><Collapsible><CollapsibleTrigger>Collapsible</CollapsibleTrigger><CollapsibleContent><p id="collapsible-prose">Collapsible prose</p></CollapsibleContent></Collapsible><Popover><PopoverTrigger>Popover</PopoverTrigger><PopoverContent><p id="popover-prose">Popover prose</p></PopoverContent></Popover><Tooltip><TooltipTrigger>Tooltip</TooltipTrigger><TooltipContent><p id="tooltip-prose">Tooltip prose</p></TooltipContent></Tooltip>';
    const generated = generate(input(source));
    const built = await buildDocumentModules(generated, { build: loadCompilerBuild(), flow: null, values: {} });
    const host = new JSDOM(`<div>${built.html}</div>`).window.document.body;
    for (const id of ['accordion-prose', 'collapsible-prose', 'popover-prose', 'tooltip-prose']) {
      expect(host.querySelector(`#${id}`)?.closest('[hidden]'), id).not.toBeNull();
    }
    for (const text of ['Accordion prose', 'Collapsible prose', 'Popover prose', 'Tooltip prose']) expect(generated.browserIslands).not.toContain(text);
  });

  it('keeps the browser module stable when only static prose around a chart changes', () => {
    const before = generate(input('<p id="lede">First</p><Question data="$rows" viz={{kind:"vega-lite", spec:{mark:"bar"}}} />'));
    const after = generate(input('<p id="lede">Second</p><Question data="$rows" viz={{kind:"vega-lite", spec:{mark:"bar"}}} />'));
    expect(after.browserIslands).toBe(before.browserIslands);
  });
});
