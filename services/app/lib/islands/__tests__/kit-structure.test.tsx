/* @jsxImportSource solid-js */
// DESTINATION: services/app/lib/islands/__tests__/kit-structure.test.tsx
/**
 * THE STRUCTURAL KIT (lib/islands/kit: basic, tabs, accordion, dialog, disclosure) renders, byte for
 * byte in what a reader notices, the DOM today's Radix-based React kit renders (Radix DOM conventions:
 * roles, aria idrefs, data-state/data-orientation/data-slot, closed content rendered hidden), and
 * behaves the same on interaction. `parityOf` (./kit-parity) is the unit-level form of the parity gate.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { diffShapes, parityOf, reactRender, shapeOf } from './kit-parity';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { renderStoryNodes } from '@/lib/story-ui/interpreter';
import { STORY_UI_COMPONENTS } from '@/lib/story-ui/registry';
import { IconGlyphProvider } from '@/components/kit/icon';
import { IslandProvider } from '../context';
import { fakeIsland } from './context.test';
import { Badge, Alert, AlertTitle, AlertDescription, Card, CardHeader, CardTitle, CardContent, Button } from '../kit/basic';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../kit/tabs';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '../kit/accordion';
import { Dialog, DialogTrigger, DialogContent, DialogClose } from '../kit/dialog';
import { Collapsible, CollapsibleTrigger, CollapsibleContent, Popover, PopoverTrigger, PopoverContent, Tooltip, TooltipContent, Avatar, AvatarImage, AvatarFallback } from '../kit/disclosure';
import { RECIPES, cn } from '../kit/recipes';

const mount = (view: () => import('solid-js').JSX.Element, portal: HTMLElement | null = null) => { const host = document.createElement('div'); const dispose = render(() => <IslandProvider value={{ ...fakeIsland(), trustedPortal: () => portal }}>{view()}</IslandProvider>, host); return { host, dispose }; };
/** Today's reader, MOUNTED: the interpreter's React tree rendered and run in the document (effects included). */
async function reactMount(markup: string) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const { nodes } = parseJsx(markup) as { nodes: JsxNode[] };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(IconGlyphProvider, { value: {} }, renderStoryNodes(nodes, { values: {}, components: STORY_UI_COMPONENTS }))); });
  return { host, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const frame = () => act(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
/** A primary-button press as a browser delivers it: mousedown, focus, mouseup, click. */
const press = (el: HTMLElement) => {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  el.focus();
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
  el.click();
};
const cls = (tag: string, props: Record<string, unknown> = {}) => cn(RECIPES[tag]!(props));

describe('basic', () => {
  it('Badge, Alert and Card match today\'s render', () => {
    const { host } = mount(() => <>
      <Badge id="b" variant="secondary" class={cls('Badge', { variant: 'secondary' })}>beta</Badge>
      <Alert id="a" class={cls('Alert', {})}><AlertTitle id="at" class={cls('AlertTitle')}>Heads up</AlertTitle><AlertDescription id="ad" class={cls('AlertDescription')}>Text.</AlertDescription></Alert>
      <Card id="c" class={cls('Card')}><CardHeader id="ch" class={cls('CardHeader')}><CardTitle id="ct" class={cls('CardTitle')}>Title</CardTitle></CardHeader><CardContent id="cc" class={cls('CardContent')}><Button id="btn" variant="outline" class={cls('Button', { variant: 'outline' })}>Go</Button></CardContent></Card>
    </>);
    expect(parityOf('<Badge id="b" variant="secondary">beta</Badge><Alert id="a"><AlertTitle id="at">Heads up</AlertTitle><AlertDescription id="ad">Text.</AlertDescription></Alert><Card id="c"><CardHeader id="ch"><CardTitle id="ct">Title</CardTitle></CardHeader><CardContent id="cc"><Button id="btn" variant="outline">Go</Button></CardContent></Card>', host)).toEqual([]);
  });
});

describe('tabs', () => {
  const markup = '<Tabs defaultValue="one" id="t"><TabsList id="l"><TabsTrigger value="one" id="t1">One</TabsTrigger><TabsTrigger value="two" id="t2">Two</TabsTrigger></TabsList><TabsContent value="one" id="c1"><p id="p1">First</p></TabsContent><TabsContent value="two" id="c2"><p id="p2">Second</p></TabsContent></Tabs>';
  const view = () => <Tabs defaultValue="one" id="t"><TabsList id="l" class={cls('TabsList')}><TabsTrigger value="one" id="t1" class={cls('TabsTrigger')}>One</TabsTrigger><TabsTrigger value="two" id="t2" class={cls('TabsTrigger')}>Two</TabsTrigger></TabsList><TabsContent value="one" id="c1" class={cls('TabsContent')}><p id="p1">First</p></TabsContent><TabsContent value="two" id="c2" class={cls('TabsContent')}><p id="p2">Second</p></TabsContent></Tabs>;
  // Radix changes the tabs once it runs (the tablist becomes tabbable, a pressed tab becomes the tab
  // stop, the mount-time panel style clears), so a MOUNTED Solid tree is held to a MOUNTED React tree —
  // what the parity gate compares. The served markup (tablist -1) is pinned against React's server render
  // in compiler.test.ts (kit fixture).
  it('renders the Radix DOM as mounted React does: tablist, tabs with aria-selected/data-state, closed content hidden and still in the DOM', async () => {
    const react = await reactMount(markup);
    const { host } = mount(view);
    document.body.append(host);
    try {
      expect(diffShapes(shapeOf(react.host), shapeOf(host))).toEqual([]);
      expect(host.querySelector('#l')?.getAttribute('tabindex')).toBe('0');
      expect(host.querySelector('#c2')?.hasAttribute('hidden')).toBe(true);
      expect([...host.querySelectorAll('[role="tabpanel"]')].some(panel => panel.id === host.querySelector('#t2')?.getAttribute('aria-controls'))).toBe(true);
    } finally { host.remove(); await react.unmount(); }
  });
  it('after a press on a tab, matches mounted React: the pressed tab is the tab stop, the mount-time panel style is cleared', async () => {
    const react = await reactMount(markup);
    const { host } = mount(view);
    document.body.append(host);
    try {
      await frame();
      for (const root of [react.host, host]) await act(async () => { press(root.querySelector('#t2') as HTMLButtonElement); });
      expect(diffShapes(shapeOf(react.host), shapeOf(host))).toEqual([]);
      expect(host.querySelector('#t2')?.getAttribute('tabindex')).toBe('0');
      expect(host.querySelector('#t1')?.getAttribute('tabindex')).toBe('-1');
      expect(host.querySelector('#c1')?.getAttribute('style')).toBe('');
      expect(host.querySelector('#c2')?.hasAttribute('style')).toBe(false);
    } finally { host.remove(); await react.unmount(); }
  });
  it('keyboard: focusing the tablist moves to the active tab; Shift+Tab takes the tablist out of the tab order until focus leaves', () => {
    const { host } = mount(view);
    document.body.append(host);
    try {
      const list = host.querySelector('#l') as HTMLElement;
      list.focus();
      expect(document.activeElement?.id).toBe('t1');
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
      expect(list.getAttribute('tabindex')).toBe('-1');
      (document.activeElement as HTMLElement).blur();
      expect(list.getAttribute('tabindex')).toBe('0');
    } finally { host.remove(); }
  });
  it('switches on click and on arrow keys, like Radix', () => {
    const { host } = mount(view);
    (host.querySelector('#t2') as HTMLButtonElement).click();
    expect(host.querySelector('#t2')?.getAttribute('data-state')).toBe('active');
    expect(host.querySelector('#c1')?.hasAttribute('hidden')).toBe(true);
    expect(host.querySelector('#c2')?.hasAttribute('hidden')).toBe(false);
    (host.querySelector('#t2') as HTMLButtonElement).focus();
    host.querySelector('#l')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(host.querySelector('#t1')?.getAttribute('data-state')).toBe('active');
  });
});

describe('accordion', () => {
  const markup = '<Accordion type="single" collapsible id="acc"><AccordionItem value="a" id="i1"><AccordionTrigger id="tr1">Question one</AccordionTrigger><AccordionContent id="co1">Answer one.</AccordionContent></AccordionItem><AccordionItem value="b" id="i2"><AccordionTrigger id="tr2">Question two</AccordionTrigger><AccordionContent id="co2">Answer two.</AccordionContent></AccordionItem></Accordion>';
  it('matches today\'s render closed and open', () => {
    const { host } = mount(() => <Accordion type="single" collapsible id="acc"><AccordionItem value="a" id="i1" class={cls('AccordionItem')}><AccordionTrigger id="tr1" class={cls('AccordionTrigger')}>Question one</AccordionTrigger><AccordionContent id="co1" class={cls('AccordionContent')}>Answer one.</AccordionContent></AccordionItem><AccordionItem value="b" id="i2" class={cls('AccordionItem')}><AccordionTrigger id="tr2" class={cls('AccordionTrigger')}>Question two</AccordionTrigger><AccordionContent id="co2" class={cls('AccordionContent')}>Answer two.</AccordionContent></AccordionItem></Accordion>);
    expect(parityOf(markup, host)).toEqual([]);
    (host.querySelector('#tr1 button, button#tr1') as HTMLButtonElement).click();
    expect(host.querySelector('#i1')?.getAttribute('data-state')).toBe('open');
    expect(host.querySelector('[role="region"]')?.hasAttribute('hidden')).toBe(false);
  });
});

describe('dialog', () => {
  it('trigger conventions match, opening renders a modal dialog, close returns to the served DOM', () => {
    const { host, dispose } = mount(() => <Dialog><DialogTrigger id="trigger" wrapsControl={true}><Button id="add" class={cls('Button')}>Add task</Button></DialogTrigger><DialogContent aria-label="Add a task" class={cls('DialogContent')}><DialogClose class={cls('DialogClose')}>Cancel</DialogClose></DialogContent></Dialog>);
    document.body.append(host);
    try {
      expect(parityOf('<Dialog><DialogTrigger id="trigger"><Button id="add">Add task</Button></DialogTrigger><DialogContent aria-label="Add a task"><DialogClose>Cancel</DialogClose></DialogContent></Dialog>', host)).toEqual([]);
      const before = host.innerHTML;
      (host.querySelector('#add') as HTMLButtonElement).click();
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
      expect(dialog?.getAttribute('aria-label')).toBe('Add a task');
      (dialog!.querySelector('button') as HTMLButtonElement).click();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(host.innerHTML).toBe(before);
    } finally {
      dispose();
      host.remove();
    }
  });
});

describe('disclosure', () => {
  it('Collapsible, Popover and Avatar match today\'s render', () => {
    const { host } = mount(() => <>
      <Collapsible id="col"><CollapsibleTrigger id="ct">More</CollapsibleTrigger><CollapsibleContent id="cc">Hidden text</CollapsibleContent></Collapsible>
      <Popover><PopoverTrigger id="pt">Open</PopoverTrigger><PopoverContent id="pc">Popped</PopoverContent></Popover>
      <Avatar id="av" class={cls('Avatar')}><AvatarImage src="/a.png" alt="A" class={cls('AvatarImage')} /><AvatarFallback class={cls('AvatarFallback')}>AB</AvatarFallback></Avatar>
    </>);
    expect(parityOf('<Collapsible id="col"><CollapsibleTrigger id="ct">More</CollapsibleTrigger><CollapsibleContent id="cc">Hidden text</CollapsibleContent></Collapsible><Popover><PopoverTrigger id="pt">Open</PopoverTrigger><PopoverContent id="pc">Popped</PopoverContent></Popover><Avatar id="av"><AvatarImage src="/a.png" alt="A" /><AvatarFallback>AB</AvatarFallback></Avatar>', host)).toEqual([]);
  });
});

describe('trusted overlay portal', () => {
  for (const portalEnabled of [true, false]) {
    it(`places Dialog content ${portalEnabled ? 'in the trusted portal' : 'in place'}`, () => {
      const portal = portalEnabled ? document.createElement('div') : null;
      const { host, dispose } = mount(() => <Dialog><DialogTrigger>Open</DialogTrigger><DialogContent aria-label="Portal dialog">Dialog body</DialogContent></Dialog>, portal);
      document.body.append(host);
      if (portal) document.body.append(portal);
      try {
        host.querySelector('button')!.click();
        const dialog = (portal ?? host).querySelector<HTMLDialogElement>('dialog');
        expect(dialog?.textContent).toBe('Dialog body');
        expect(dialog?.open).toBe(true);
        if (portal) expect(host.querySelector('dialog')).toBeNull();
        dialog!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(dialog?.open).toBe(false);
        if (portal) expect(portal.querySelector('dialog')).toBeNull();
      } finally { dispose(); host.remove(); portal?.remove(); }
    });
    it(`places Popover content ${portalEnabled ? 'in the trusted portal' : 'in place'}`, () => {
      const portal = portalEnabled ? document.createElement('div') : null;
      const { host, dispose } = mount(() => <Popover><PopoverTrigger>Open</PopoverTrigger><PopoverContent>Popover body</PopoverContent></Popover>, portal);
      try {
        host.querySelector('button')!.click();
        expect((portal ?? host).querySelector('[data-slot="popover-content"]')?.textContent).toBe('Popover body');
        if (portal) expect(host.querySelector('[data-slot="popover-content"]')).toBeNull();
        (portal ?? host).querySelector('[data-slot="popover-content"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect((portal ?? host).querySelector('[data-slot="popover-content"]')).toBeNull();
      } finally { dispose(); }
    });
    it(`places Tooltip content ${portalEnabled ? 'in the trusted portal' : 'in place'}`, () => {
      const portal = portalEnabled ? document.createElement('div') : null;
      const { host, dispose } = mount(() => <Tooltip defaultOpen><TooltipContent>Tooltip body</TooltipContent></Tooltip>, portal);
      try {
        expect((portal ?? host).querySelector('[data-slot="tooltip-content"]')?.textContent).toBe('Tooltip body');
        if (portal) expect(host.querySelector('[data-slot="tooltip-content"]')).toBeNull();
      } finally { dispose(); }
    });
  }
});


describe('compile-time structure recipes', () => {
  const cases: Array<{ tag: string; markup: string; props?: Record<string, unknown>; path?: number[] }> = [
    { tag: 'Badge', markup: '<Badge>new</Badge>' },
    { tag: 'Badge', markup: '<Badge variant="secondary">new</Badge>', props: { variant: 'secondary' } },
    { tag: 'Alert', markup: '<Alert>text</Alert>' },
    { tag: 'Alert', markup: '<Alert variant="destructive">text</Alert>', props: { variant: 'destructive' } },
    { tag: 'Button', markup: '<Button>Save</Button>' },
    { tag: 'Button', markup: '<Button variant="outline" size="sm">Save</Button>', props: { variant: 'outline', size: 'sm' } },
    { tag: 'TabsList', markup: '<Tabs defaultValue="one"><TabsList><TabsTrigger value="one">One</TabsTrigger></TabsList></Tabs>', path: [0] },
    { tag: 'TabsList', markup: '<Tabs defaultValue="one"><TabsList variant="line"><TabsTrigger value="one">One</TabsTrigger></TabsList></Tabs>', props: { variant: 'line' }, path: [0] },
    { tag: 'AccordionItem', markup: '<Accordion type="single"><AccordionItem value="one"><AccordionTrigger>One</AccordionTrigger></AccordionItem></Accordion>', path: [0] },
    { tag: 'DialogContent', markup: '<Dialog><DialogContent aria-label="Example">Body</DialogContent></Dialog>', path: [0] },
    { tag: 'DialogTrigger', markup: '<Dialog><DialogTrigger>Open</DialogTrigger></Dialog>', path: [0] },
    { tag: 'DialogClose', markup: '<Dialog><DialogClose>Close</DialogClose></Dialog>', path: [0] },
    { tag: 'PopoverTitle', markup: '<PopoverTitle>Body</PopoverTitle>' },
    { tag: 'Avatar', markup: '<Avatar><AvatarFallback>AB</AvatarFallback></Avatar>' },
    { tag: 'Avatar', markup: '<Avatar size="sm"><AvatarFallback>AB</AvatarFallback></Avatar>', props: { size: 'sm' } },
  ];
  for (const { tag, markup, props = {}, path = [] } of cases) it(`${tag} recipe matches today's class for ${JSON.stringify(props)}`, () => {
    let node = shapeOf(reactRender(markup))[0]!;
    for (const index of path) node = node.kids[index]!;
    expect(cn(RECIPES[tag]!(props)).split(/\s+/).sort()).toEqual((node.attrs.class ?? '').split(/\s+/).sort());
  });
  it("merges an author className with today's class", () => {
    const markup = '<Badge variant="secondary" className="rounded-none bg-lime-500">new</Badge>';
    const expected = shapeOf(reactRender(markup))[0]!.attrs.class;
    expect(cn(RECIPES.Badge!({ variant: 'secondary', className: 'rounded-none bg-lime-500' })).split(/\s+/).sort()).toEqual(expected.split(/\s+/).sort());
  });
});


describe('dialog interaction with its own resolved recipe', () => {
  it('opens, closes, and restores trigger focus', () => {
    const { host, dispose } = mount(() => <Dialog><DialogTrigger id="open-dialog">Open</DialogTrigger><DialogContent aria-label="Example" class={cls('DialogContent')}><DialogClose class={cls('Button', { variant: 'outline' })}>Close</DialogClose></DialogContent></Dialog>);
    const trigger = host.querySelector<HTMLButtonElement>('#open-dialog')!;
    trigger.focus(); trigger.click();
    const dialog = host.querySelector<HTMLDialogElement>('dialog')!;
    expect(dialog.open).toBe(true);
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dialog.open).toBe(false);
    trigger.click();
    expect(dialog.open).toBe(true);
    dialog.querySelector<HTMLButtonElement>('button')!.click();
    expect(dialog.open).toBe(false);
    dispose();
  });
});
