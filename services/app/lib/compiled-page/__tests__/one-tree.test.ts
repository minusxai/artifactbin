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
    // The server half: the skeleton and its pre-rendered static chunks.
    const server = `${result.skeleton}${result.staticHtml.join('')}`;
    expect(result.skeleton).toContain('NoHydration');
    expect(server).toContain('Server prose');
    expect(server).toContain('Panel prose');
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
  it('serves direct text inside a closed accordion panel', async () => {
    const source = '<Accordion defaultValue="a"><AccordionItem value="a"><AccordionTrigger>First</AccordionTrigger><AccordionContent>Open by default.</AccordionContent></AccordionItem><AccordionItem value="b"><AccordionTrigger>Second</AccordionTrigger><AccordionContent>Collapsed until clicked.</AccordionContent></AccordionItem></Accordion>';
    const generated = generate(input(source));
    const built = await buildDocumentModules(generated, { build: loadCompilerBuild(), flow: null, values: {} });
    const host = new JSDOM(`<div>${built.html}</div>`).window.document.body;
    const panel = host.querySelectorAll('[data-slot="accordion-content"]')[1];
    expect(panel?.textContent).toContain('Collapsed until clicked.');
  });

  it('keeps the browser module stable when only static prose around a chart changes', () => {
    const before = generate(input('<p id="lede">First</p><Question data="$rows" viz={{kind:"vega-lite", spec:{mark:"bar"}}} />'));
    const after = generate(input('<p id="lede">Second</p><Question data="$rows" viz={{kind:"vega-lite", spec:{mark:"bar"}}} />'));
    expect(after.browserIslands).toBe(before.browserIslands);
  });
  it('hydrates a static wrapper without embedding its server-owned id in the browser module', () => {
    const before = generate(input('<div id="first-wrap"><p>First</p><Question id="chart" data="$rows" viz={{kind:"vega-lite", spec:{mark:"bar"}}} /></div>'));
    const after = generate(input('<div id="second-wrap"><p>Second</p><Question id="chart" data="$rows" viz={{kind:"vega-lite", spec:{mark:"bar"}}} /></div>'));
    expect(after.browserIslands).toBe(before.browserIslands);
  });
  it('imports kit components rendered only inside browser rows and table cells', () => {
    const result = generate(input('<Helmet><Value name="rows" type="table" value={[{"id":1}]} /></Helmet><For each={$rows} keyBy="id"><Badge>Row</Badge><Button run="$complete">Complete</Button></For><DataTable data="$rows"><Column col="id"><Button run="$complete">Cell</Button></Column></DataTable>'));
    expect(result.browserIslands).toMatch(/import \{[^}]*Badge[^}]*Button[^}]*\} from "@mx\/kit\/basic"/);
  });
});
