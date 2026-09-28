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
import { parityOf } from './kit-parity';
import { IslandProvider } from '../context';
import { fakeIsland } from './context.test';
import { Badge, Alert, AlertTitle, AlertDescription, Card, CardHeader, CardTitle, CardContent, Button } from '../kit/basic';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../kit/tabs';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '../kit/accordion';
import { Dialog, DialogTrigger, DialogContent, DialogClose } from '../kit/dialog';
import { Collapsible, CollapsibleTrigger, CollapsibleContent, Popover, PopoverTrigger, PopoverContent, Avatar, AvatarImage, AvatarFallback } from '../kit/disclosure';
import { RECIPES, cn } from '../kit/recipes';

const mount = (view: () => import('solid-js').JSX.Element) => { const host = document.createElement('div'); const dispose = render(() => <IslandProvider value={fakeIsland()}>{view()}</IslandProvider>, host); return { host, dispose }; };
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
  it('renders the Radix DOM: tablist, tabs with aria-selected/data-state, closed content hidden and still in the DOM', () => {
    const { host } = mount(view);
    expect(parityOf(markup, host)).toEqual([]);
    expect(host.querySelector('#c2')?.hasAttribute('hidden')).toBe(true);
    expect(host.querySelector('#t2')?.getAttribute('aria-controls')).toBe('c2');
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
    const { host } = mount(() => <Dialog><DialogTrigger id="trigger" wrapsControl={true}><Button id="add" class={cls('Button')}>Add task</Button></DialogTrigger><DialogContent aria-label="Add a task" class={cls('DialogContent')}><DialogClose class={cls('Button')}>Cancel</DialogClose></DialogContent></Dialog>);
    expect(parityOf('<Dialog><DialogTrigger id="trigger"><Button id="add">Add task</Button></DialogTrigger><DialogContent aria-label="Add a task"><DialogClose>Cancel</DialogClose></DialogContent></Dialog>', host)).toEqual([]);
    const before = host.innerHTML;
    (host.querySelector('#add') as HTMLButtonElement).click();
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Add a task');
    (dialog!.querySelector('button') as HTMLButtonElement).click();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.innerHTML).toBe(before);
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
