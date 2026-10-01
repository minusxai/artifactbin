/* @jsxImportSource solid-js */
// DESTINATION: services/app/lib/islands/__tests__/kit-structure.test.tsx
/**
 * THE STRUCTURAL KIT (lib/islands/kit: basic, tabs, accordion, dialog, disclosure) keeps Radix's DOM
 * conventions — roles, aria idrefs that resolve, data-state/data-orientation/data-slot, closed content
 * rendered hidden — and behaves the same on interaction. Classes come from the compile-time recipes.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
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
    const badge = host.querySelector('#b')!;
    expect([badge.tagName, badge.getAttribute('data-slot'), badge.getAttribute('data-variant'), badge.textContent]).toEqual(['SPAN', 'badge', 'secondary', 'beta']);
    expect(host.querySelector('#a')?.getAttribute('role')).toBe('alert');
    expect(['at', 'ad', 'c', 'ch', 'ct', 'cc'].map((id) => host.querySelector(`#${id}`)?.getAttribute('data-slot'))).toEqual(['alert-title', 'alert-description', 'card', 'card-header', 'card-title', 'card-content']);
    expect(host.querySelector('#c #ch #ct')?.textContent).toBe('Title');
    const button = host.querySelector('#cc > button#btn')!;
    expect([button.getAttribute('data-slot'), button.getAttribute('data-variant'), button.getAttribute('data-size'), button.textContent]).toEqual(['button', 'outline', 'default', 'Go']);
  });
});

describe('progress and separator', () => {
  it('a Progress is a 0–100 progressbar whose indicator shows its value, a Separator is decorative unless told otherwise', () => {
    const { host } = mount(() => <>
      <Progress id="p1" value={42} class={cls('Progress', {})} />
      <Progress id="p2" value={100} class={cls('Progress', {})} />
      <Progress id="p3" class={cls('Progress', {})} />
      <Separator id="s1" class={cls('Separator', {})} />
      <Separator id="s2" orientation="vertical" decorative={false} class={cls('Separator', {})} />
    </>);
    for (const id of ['p1', 'p2', 'p3']) {
      const bar = host.querySelector(`#${id}`)!;
      expect([bar.getAttribute('role'), bar.getAttribute('aria-valuemin'), bar.getAttribute('aria-valuemax'), bar.getAttribute('data-slot')]).toEqual(['progressbar', '0', '100', 'progress']);
    }
    expect(['p1', 'p2', 'p3'].map((id) => host.querySelector<HTMLElement>(`#${id} [data-slot="progress-indicator"]`)?.style.transform)).toEqual(['translateX(-58%)', 'translateX(-0%)', 'translateX(-100%)']);
    const [decorative, semantic] = [host.querySelector('#s1')!, host.querySelector('#s2')!];
    expect([decorative.getAttribute('role'), decorative.getAttribute('data-orientation'), decorative.hasAttribute('aria-orientation')]).toEqual(['none', 'horizontal', false]);
    expect([semantic.getAttribute('role'), semantic.getAttribute('data-orientation'), semantic.getAttribute('aria-orientation')]).toEqual(['separator', 'vertical', 'vertical']);
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
  it('renders closed items as headed triggers labelling hidden regions, and opens one on click', () => {
    const { host } = mount(() => <Accordion type="single" collapsible id="acc"><AccordionItem value="a" id="i1" class={cls('AccordionItem')}><AccordionTrigger id="tr1" class={cls('AccordionTrigger')}>Question one</AccordionTrigger><AccordionContent id="co1" class={cls('AccordionContent')}>Answer one.</AccordionContent></AccordionItem><AccordionItem value="b" id="i2" class={cls('AccordionItem')}><AccordionTrigger id="tr2" class={cls('AccordionTrigger')}>Question two</AccordionTrigger><AccordionContent id="co2" class={cls('AccordionContent')}>Answer two.</AccordionContent></AccordionItem></Accordion>);
    expect(host.querySelector('#acc')?.getAttribute('data-orientation')).toBe('vertical');
    for (const [item, trigger, content, label] of [['i1', 'tr1', 'co1', 'Question one'], ['i2', 'tr2', 'co2', 'Question two']] as const) {
      expect(host.querySelector(`#${item}`)?.getAttribute('data-state')).toBe('closed');
      const button = host.querySelector(`#${item} > h3 > button#${trigger}`)!;
      expect([button.getAttribute('aria-expanded'), button.textContent]).toEqual(['false', label]);
      const region = host.querySelector(`#${content}`)!;
      expect([region.getAttribute('role'), region.hasAttribute('hidden')]).toEqual(['region', true]);
      expect(region.getAttribute('aria-labelledby')).toBe(trigger);
      if (button.hasAttribute('aria-controls')) expect(button.getAttribute('aria-controls')).toBe(content);
    }
    (host.querySelector('#tr1 button, button#tr1') as HTMLButtonElement).click();
    expect(host.querySelector('#i1')?.getAttribute('data-state')).toBe('open');
    expect(host.querySelector('[role="region"]')?.hasAttribute('hidden')).toBe(false);
  });
});

describe('accordion without authored ids', () => {
  it('labels each region by the trigger that is really in the document', () => {
    const { host } = mount(() => <Accordion type="single"><AccordionItem value="a"><AccordionTrigger>One</AccordionTrigger><AccordionContent id="co">Answer.</AccordionContent></AccordionItem><AccordionItem value="b"><AccordionTrigger>Two</AccordionTrigger><AccordionContent>Answer.</AccordionContent></AccordionItem></Accordion>);
    for (const region of host.querySelectorAll('[role="region"]')) {
      const labelled = region.getAttribute('aria-labelledby')!;
      expect(host.querySelector(`button[id="${labelled}"]`)?.closest('[data-slot="accordion-item"]')).toBe(region.closest('[data-slot="accordion-item"]'));
    }
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
      // The trigger wraps the authored button; the closed modal is served in place, labelled, with its close control.
      expect(host.querySelector('#trigger > button#add')?.textContent).toBe('Add task');
      const served = host.querySelector('dialog')!;
      expect([served.getAttribute('aria-modal'), served.getAttribute('aria-label'), served.getAttribute('tabindex'), served.querySelector('button')?.textContent]).toEqual(['true', 'Add a task', '-1', 'Cancel']);
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
  it('a closed Popover trigger announces its dialog, and an Avatar without a loaded image shows its fallback', () => {
    const { host } = mount(() => <>
      <Popover><PopoverTrigger id="pt">Open</PopoverTrigger><PopoverContent id="pc">Popped</PopoverContent></Popover>
      <Avatar id="av" class={cls('Avatar')}><AvatarImage src="/a.png" alt="A" class={cls('AvatarImage')} /><AvatarFallback class={cls('AvatarFallback')}>AB</AvatarFallback></Avatar>
    </>);
    const trigger = host.querySelector('#pt')!;
    expect([trigger.tagName, trigger.getAttribute('aria-haspopup'), trigger.getAttribute('aria-expanded'), trigger.getAttribute('data-state'), trigger.getAttribute('data-slot')]).toEqual(['BUTTON', 'dialog', 'false', 'closed', 'popover-trigger']);
    expect(host.querySelector('#pc')).toBeNull();
    expect(host.querySelector('#av')?.getAttribute('data-slot')).toBe('avatar');
    expect(host.querySelector('#av [data-slot="avatar-fallback"]')?.textContent).toBe('AB');
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
  // The structural kit renders no class of its own: the compiler writes RECIPES[tag](props) onto the served
  // root. What a recipe must guarantee is that a variant changes the class and an author's class wins.
  it('a variant changes the class, and an author className replaces the conflicting defaults', () => {
    expect(cn(RECIPES.Badge!({ variant: 'secondary' }))).not.toBe(cn(RECIPES.Badge!({})));
    expect(cn(RECIPES.Button!({ variant: 'outline', size: 'sm' }))).not.toBe(cn(RECIPES.Button!({})));
    const base = cn(RECIPES.Badge!({ variant: 'secondary' })).split(/\s+/);
    const authored = cn(RECIPES.Badge!({ variant: 'secondary', className: 'rounded-none bg-lime-500' })).split(/\s+/);
    expect(base).toContain('rounded-full');
    expect(authored).toEqual(expect.arrayContaining(['rounded-none', 'bg-lime-500']));
    expect(authored).not.toContain('rounded-full');
    expect(authored.filter((token) => /^bg-(?!lime-500$)[\w-]+$/.test(token))).toEqual([]);
  });
});
