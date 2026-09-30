/* @jsxImportSource solid-js */
// DESTINATION: services/app/lib/islands/__tests__/kit-structure.test.tsx
/**
 * THE STRUCTURAL KIT (lib/islands/kit: basic, tabs, accordion, dialog, disclosure) renders, byte for
 * byte in what a reader notices, the DOM today's Radix-based React kit renders (Radix DOM conventions:
 * roles, aria idrefs, data-state/data-orientation/data-slot, closed content rendered hidden), and
 * behaves the same on interaction. `parityOf` (./kit-parity) is the unit-level form of the parity gate.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { parityOf, reactRender, shapeOf } from './kit-parity';
import { IslandProvider } from '../context';
import { fakeIsland } from './context.test';
import { Badge, Alert, AlertTitle, AlertDescription, Card, CardHeader, CardTitle, CardContent, Button, Icon } from '../kit/basic';
import { Progress, Separator } from '../kit/static/misc';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../kit/tabs';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '../kit/accordion';
import { Dialog, DialogTrigger, DialogContent, DialogClose } from '../kit/dialog';
import { Popover, PopoverTrigger, PopoverContent, Tooltip, TooltipTrigger, TooltipContent, Avatar, AvatarImage, AvatarFallback } from '../kit/disclosure';
import { RECIPES, cn } from '../kit/recipes';

const mount = (view: () => import('solid-js').JSX.Element, portal: HTMLElement | null = null) => { const host = document.createElement('div'); const dispose = render(() => <IslandProvider value={{ ...fakeIsland(), trustedPortal: () => portal }}>{view()}</IslandProvider>, host); return { host, dispose }; };
const cls = (tag: string, props: Record<string, unknown> = {}) => cn(RECIPES[tag]!(props));

describe('basic', () => {
  it('loads an unseen row icon from the optional glyph catalog', async () => {
    const fallback = { cls: 'lucide-circle-question-mark', inner: '<circle cx="12" cy="12" r="10"></circle>' };
    const check = { cls: 'lucide-check', inner: '<path d="m20 6-11 11-5-5"></path>' };
    const url = 'data:text/javascript,' + encodeURIComponent(`export const glyphs = ${JSON.stringify({ Check: check })}`);
    const { host, dispose } = mount(() => <Icon name="check" glyphs={{ CircleQuestionMark: fallback }} catalogUrl={url} />);
    try {
      expect(host.querySelector('circle')).toBeTruthy();
      await vi.waitFor(() => expect(host.querySelector('path')?.getAttribute('d')).toBe(check.inner.match(/d="([^"]+)/)?.[1]));
    } finally { dispose(); }
  });
  it('Badge, Alert and Card match today\'s render', () => {
    const { host } = mount(() => <>
      <Badge id="b" variant="secondary" class={cls('Badge', { variant: 'secondary' })}>beta</Badge>
      <Alert id="a" class={cls('Alert', {})}><AlertTitle id="at" class={cls('AlertTitle')}>Heads up</AlertTitle><AlertDescription id="ad" class={cls('AlertDescription')}>Text.</AlertDescription></Alert>
      <Card id="c" class={cls('Card')}><CardHeader id="ch" class={cls('CardHeader')}><CardTitle id="ct" class={cls('CardTitle')}>Title</CardTitle></CardHeader><CardContent id="cc" class={cls('CardContent')}><Button id="btn" variant="outline" class={cls('Button', { variant: 'outline' })}>Go</Button></CardContent></Card>
    </>);
    expect(parityOf('<Badge id="b" variant="secondary">beta</Badge><Alert id="a"><AlertTitle id="at">Heads up</AlertTitle><AlertDescription id="ad">Text.</AlertDescription></Alert><Card id="c"><CardHeader id="ch"><CardTitle id="ct">Title</CardTitle></CardHeader><CardContent id="cc"><Button id="btn" variant="outline">Go</Button></CardContent></Card>', host)).toEqual([]);
  });
});

describe('progress and separator', () => {
  it('a value renders Radix\'s loading/complete state and aria-valuenow, matching today\'s render', () => {
    const { host } = mount(() => <>
      <Progress id="p1" value={42} class={cls('Progress', {})} />
      <Progress id="p2" value={100} class={cls('Progress', {})} />
      <Progress id="p3" class={cls('Progress', {})} />
      <Separator id="s1" class={cls('Separator', {})} />
      <Separator id="s2" orientation="vertical" decorative={false} class={cls('Separator', {})} />
    </>);
    expect(parityOf('<Progress id="p1" value={42} /><Progress id="p2" value={100} /><Progress id="p3" /><Separator id="s1" /><Separator id="s2" orientation="vertical" decorative={false} />', host)).toEqual([]);
  });
});

describe('tabs', () => {
  const view = () => <Tabs defaultValue="one" id="t"><TabsList id="l" class={cls('TabsList')}><TabsTrigger value="one" id="t1" class={cls('TabsTrigger')}>One</TabsTrigger><TabsTrigger value="two" id="t2" class={cls('TabsTrigger')}>Two</TabsTrigger></TabsList><TabsContent value="one" id="c1" class={cls('TabsContent')}><p id="p1">First</p></TabsContent><TabsContent value="two" id="c2" class={cls('TabsContent')}><p id="p2">Second</p></TabsContent></Tabs>;
  // Radix changes the tabs once it runs (the tablist becomes tabbable, a pressed tab becomes the tab
  // stop, the mount-time panel style clears), so a MOUNTED Solid tree is held to a MOUNTED React tree —
  // what the parity gate compares. The served markup (tablist -1) is pinned against React's server render
  // in compiler.test.ts (kit fixture).
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
  it('writes an authored boolean open value when its trigger and close controls are used', () => {
    const [open, setOpen] = createSignal(false);
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <IslandProvider value={{ ...fakeIsland(), value: () => open(), setValue: (_name, next) => setOpen(next === true) }}>
      <Dialog open={'$sprint_open' as never}><DialogTrigger id="open-sprint">Add Sprint</DialogTrigger><DialogContent aria-label="Add sprint"><DialogClose>Cancel</DialogClose></DialogContent></Dialog>
    </IslandProvider>, host);
    try {
      expect(host.querySelector('[role="dialog"]')).toBeNull();
      host.querySelector<HTMLButtonElement>('#open-sprint')!.click();
      expect(open()).toBe(true);
      expect(host.querySelector('[role="dialog"]')).not.toBeNull();
      host.querySelector<HTMLButtonElement>('dialog button')!.click();
      expect(open()).toBe(false);
    } finally { dispose(); host.remove(); }
  });
  it('trigger conventions match, opening renders a modal dialog, close returns to the served DOM', () => {
    const { host, dispose } = mount(() => <Dialog><DialogTrigger id="trigger" wrapsControl={true}><Button id="add" class={cls('Button')}>Add task</Button></DialogTrigger><DialogContent aria-label="Add a task" class={cls('DialogContent')}><DialogClose class={cls('DialogClose')}>Cancel</DialogClose></DialogContent></Dialog>);
    document.body.append(host);
    try {
      // The one-tree close marker adds only an internal attribute so an adopted button can close its modal.
      expect(parityOf('<Dialog><DialogTrigger id="trigger"><Button id="add">Add task</Button></DialogTrigger><DialogContent aria-label="Add a task"><DialogClose>Cancel</DialogClose></DialogContent></Dialog>', host)
        .filter(diff => !diff.includes('@data-mx-dialog-close: undefined vs ""'))).toEqual([]);
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
  it('Popover and Avatar match today\'s render', () => {
    const { host } = mount(() => <>
      <Popover><PopoverTrigger id="pt">Open</PopoverTrigger><PopoverContent id="pc">Popped</PopoverContent></Popover>
      <Avatar id="av" class={cls('Avatar')}><AvatarImage src="/a.png" alt="A" class={cls('AvatarImage')} /><AvatarFallback class={cls('AvatarFallback')}>AB</AvatarFallback></Avatar>
    </>);
    expect(parityOf('<Popover><PopoverTrigger id="pt">Open</PopoverTrigger><PopoverContent id="pc">Popped</PopoverContent></Popover><Avatar id="av"><AvatarImage src="/a.png" alt="A" /><AvatarFallback>AB</AvatarFallback></Avatar>', host)).toEqual([]);
  });
  it('opening another Popover dismisses the first and Escape restores focus', () => {
    const { host, dispose } = mount(() => <><Popover><PopoverTrigger>First</PopoverTrigger><PopoverContent>First body</PopoverContent></Popover><Popover><PopoverTrigger>Second</PopoverTrigger><PopoverContent>Second body</PopoverContent></Popover></>);
    document.body.append(host);
    try {
      const triggers = host.querySelectorAll<HTMLButtonElement>('[data-slot="popover-trigger"]');
      triggers[0]!.click(); triggers[1]!.click();
      expect(triggers[0]!.getAttribute('aria-expanded')).toBe('false');
      expect(triggers[1]!.getAttribute('aria-expanded')).toBe('true');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(triggers[1]!.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(triggers[1]);
    } finally { dispose(); host.remove(); }
  });
});

describe('tooltip, as today\'s story tooltip runs', () => {
  it('leaves placement unloaded until the reader signals readiness', async () => {
    document.documentElement.removeAttribute('data-mx-ready');
    const { host, dispose } = mount(() => <Tooltip defaultOpen><TooltipTrigger>Target</TooltipTrigger><TooltipContent>Tooltip body</TooltipContent></Tooltip>);
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(host.querySelector('[data-slot="tooltip-trigger"]')?.hasAttribute('data-radix-popper-side')).toBe(false);
      document.documentElement.setAttribute('data-mx-ready', '');
      document.dispatchEvent(new Event('mx:ready'));
      await vi.waitFor(() => expect(host.querySelector('[data-slot="tooltip-trigger"]')?.getAttribute('data-radix-popper-side')).toBe('top'));
    } finally { dispose(); document.documentElement.removeAttribute('data-mx-ready'); }
  });

});


/**
 * Accordion and Collapsible content, MOUNTED on both sides: Radix measures the content once it runs and
 * on every open/close, writing through the CSSOM (the served style string comes back in its form, the
 * mount-time `transition-duration: 0s; animation-name: none` stays on content open on mount).
 */

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
    it(`anchors Popover content to its trigger ${portalEnabled ? 'in the trusted portal' : 'in place'}`, async () => {
      const portal = portalEnabled ? document.createElement('div') : null;
      const { host, dispose } = mount(() => <Popover><PopoverTrigger>Open</PopoverTrigger><PopoverContent>Popover body</PopoverContent></Popover>, portal);
      const rect = (left: number, top: number, width: number, height: number) => ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) }) as DOMRect;
      const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        return this.getAttribute('data-slot') === 'popover-trigger' ? rect(500, 300, 100, 30) : this.hasAttribute('data-radix-popper-content-wrapper') || this.getAttribute('data-slot') === 'popover-content' ? rect(0, 0, 288, 100) : rect(0, 0, 0, 0);
      });
      // floating-ui measures an element by its offset size; jsdom has no layout, so give the popover one.
      const size = (axis: 'offsetWidth' | 'offsetHeight', value: number) => vi.spyOn(HTMLElement.prototype, axis, 'get').mockImplementation(function (this: HTMLElement) { return this.hasAttribute('data-radix-popper-content-wrapper') || this.getAttribute('data-slot') === 'popover-content' ? value : this.getAttribute('data-slot') === 'popover-trigger' ? (axis === 'offsetWidth' ? 100 : 30) : 0; });
      const viewport = (axis: 'clientWidth' | 'clientHeight', value: number) => vi.spyOn(document.documentElement, axis, 'get').mockReturnValue(value);
      const sizes = [size('offsetWidth', 288), size('offsetHeight', 100), viewport('clientWidth', 1024), viewport('clientHeight', 768)];
      try {
        host.querySelector('button')!.click();
        const wrapper = (portal ?? host).querySelector<HTMLElement>('[data-radix-popper-content-wrapper]')!;
        expect(wrapper.querySelector('[data-slot="popover-content"]')?.textContent).toBe('Popover body');
        await vi.waitFor(() => expect(wrapper.style.transform).toMatch(/px/));
        // Centred under the trigger (500 + 50 - 288 / 2) and 4px below it (300 + 30 + 4), never the viewport's corner.
        expect(wrapper.style.position).toBe('fixed');
        expect(wrapper.style.transform).toBe('translate(406px, 334px)');
        expect(wrapper.querySelector('[data-slot="popover-content"]')?.getAttribute('data-side')).toBe('bottom');
      } finally { spy.mockRestore(); sizes.forEach(mock => mock.mockRestore()); dispose(); }
    });
    // Today's story tooltip portals like Radix's Portal: to the trusted container when the page has one, else to the
    // BODY — never in place (the parity gate's probe of today's reader: the content's top element is a child of <body>).
    it(`places Tooltip content ${portalEnabled ? 'in the trusted portal' : 'in the body, as Radix does without one'}`, () => {
      const portal = portalEnabled ? document.createElement('div') : null;
      const { host, dispose } = mount(() => <Tooltip defaultOpen><TooltipTrigger>Target</TooltipTrigger><TooltipContent>Tooltip body</TooltipContent></Tooltip>, portal);
      document.body.append(host);
      try {
        expect((portal ?? document.body).querySelector('[data-slot="tooltip-content"]')?.textContent).toBe('Tooltip body');
        expect(host.querySelector('[data-slot="tooltip-content"]')).toBeNull();
      } finally { dispose(); host.remove(); }
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
  it('focuses the authored field after a framed dialog opens', async () => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; this.focus(); } });
    const host = document.createElement('div'); document.body.append(host);
    const dispose = render(() => <IslandProvider value={fakeIsland()}><Dialog><DialogTrigger>Open</DialogTrigger><DialogContent aria-label="Focused dialog"><input aria-label="Draft" autofocus /></DialogContent></Dialog></IslandProvider>, host);
    try {
      host.querySelector<HTMLButtonElement>('button')!.click();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      expect(document.activeElement).toBe(host.querySelector('[aria-label="Draft"]'));
    } finally { dispose(); host.remove(); Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); }
  });
  it('writes a bound open Value and follows it when the trigger is pressed', () => {
    const [open, setOpen] = createSignal(false);
    const host = document.createElement('div');
    const island = { ...fakeIsland(), value: (name: string) => name === 'open' ? open() : undefined, setValue: (name: string, value: unknown) => { if (name === 'open') setOpen(Boolean(value)); } };
    const dispose = render(() => <IslandProvider value={island as import('../contract').IslandContext}><Dialog open="$open"><DialogTrigger>Open</DialogTrigger><DialogContent aria-label="Bound dialog">Body</DialogContent></Dialog></IslandProvider>, host);
    host.querySelector<HTMLButtonElement>('button')!.click();
    expect(open()).toBe(true);
    expect(host.querySelector<HTMLDialogElement>('dialog')?.open).toBe(true);
    dispose();
  });
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
