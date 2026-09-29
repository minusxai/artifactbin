/* @jsxImportSource solid-js */
import { describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../kit/accordion';
import { Collapsible, CollapsibleContent, CollapsibleTrigger, Popover, PopoverContent, PopoverTrigger, Tooltip, TooltipContent, TooltipTrigger } from '../kit/disclosure';
import { IslandProvider } from '../context';
import { fakeIsland } from './context.test';

describe('server owned content in closed controls', () => {
  it('retains an accordion panel node when it opens and closes', () => {
    const host = document.createElement('div'); document.body.append(host);
    const dispose = render(() => <Accordion collapsible><AccordionItem value="one"><AccordionTrigger>Toggle</AccordionTrigger><AccordionContent forceMount><p id="panel-static">Static panel</p></AccordionContent></AccordionItem></Accordion>, host);
    const paragraph = host.querySelector('#panel-static');
    expect(paragraph).not.toBeNull();
    expect(paragraph?.closest('[role="region"]')?.hasAttribute('hidden')).toBe(true);
    const trigger = host.querySelector<HTMLButtonElement>('button')!;
    trigger.click();
    expect(host.querySelector('#panel-static')).toBe(paragraph);
    expect(paragraph?.closest('[role="region"]')?.hasAttribute('hidden')).toBe(false);
    trigger.click();
    expect(host.querySelector('#panel-static')).toBe(paragraph);
    dispose(); host.remove();
  });

  it('retains a collapsible panel node when it opens and closes', () => {
    const host = document.createElement('div'); document.body.append(host);
    const dispose = render(() => <Collapsible><CollapsibleTrigger>Toggle</CollapsibleTrigger><CollapsibleContent forceMount><p id="panel-static">Static panel</p></CollapsibleContent></Collapsible>, host);
    const paragraph = host.querySelector('#panel-static');
    expect(paragraph).not.toBeNull();
    expect(paragraph?.closest('[data-slot="collapsible-content"]')?.hasAttribute('hidden')).toBe(true);
    const trigger = host.querySelector<HTMLButtonElement>('button')!;
    trigger.click();
    expect(host.querySelector('#panel-static')).toBe(paragraph);
    expect(paragraph?.closest('[data-slot="collapsible-content"]')?.hasAttribute('hidden')).toBe(false);
    trigger.click();
    expect(host.querySelector('#panel-static')).toBe(paragraph);
    dispose(); host.remove();
  });

  it('keeps a closed popover subtree while moving its same node to the trusted portal', () => {
    const host = document.createElement('div'); const portal = document.createElement('div'); document.body.append(host, portal);
    const dispose = render(() => <IslandProvider value={{ ...fakeIsland(), trustedPortal: () => portal }}><Popover><PopoverTrigger>Open</PopoverTrigger><PopoverContent forceMount><p id="popover-static">Static popover</p></PopoverContent></Popover></IslandProvider>, host);
    const paragraph = host.querySelector('#popover-static');
    expect(paragraph).not.toBeNull();
    expect(paragraph?.closest('[hidden]')).not.toBeNull();
    host.querySelector<HTMLButtonElement>('button')!.click();
    expect(portal.querySelector('#popover-static')).toBe(paragraph);
    portal.querySelector<HTMLElement>('[data-slot="popover-content"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(host.querySelector('#popover-static')).toBe(paragraph);
    dispose(); host.remove(); portal.remove();
  });

  it('keeps a closed tooltip subtree while moving its same node to the body', () => {
    const host = document.createElement('div'); document.body.append(host);
    const dispose = render(() => <IslandProvider value={fakeIsland()}><Tooltip><TooltipTrigger>Target</TooltipTrigger><TooltipContent forceMount><p id="tooltip-static">Static tooltip</p></TooltipContent></Tooltip></IslandProvider>, host);
    const paragraph = host.querySelector('#tooltip-static');
    expect(paragraph).not.toBeNull();
    expect(paragraph?.closest('[hidden]')).not.toBeNull();
    host.querySelector<HTMLButtonElement>('button')!.focus();
    expect(document.body.querySelector('#tooltip-static')).toBe(paragraph);
    expect(host.querySelector('#tooltip-static')).toBeNull();
    host.querySelector<HTMLButtonElement>('button')!.blur();
    expect(host.querySelector('#tooltip-static')).toBe(paragraph);
    dispose(); host.remove();
  });
});
