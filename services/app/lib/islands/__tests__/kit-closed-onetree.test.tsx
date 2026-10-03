/* @jsxImportSource solid-js */
import { describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../kit/accordion';
import { Collapsible, CollapsibleContent, CollapsibleTrigger, Popover, PopoverContent, PopoverTrigger, Tooltip, TooltipContent, TooltipTrigger } from '../kit/disclosure';
import { Dialog, DialogContent, DialogTrigger } from '../kit/dialog';
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

/**
 * A served document framed on its own origin carries its story CSS (`style[data-mx-tw]`) and, for the reader's own
 * UI, a trusted host whose portal lives in a shadow root the story CSS cannot reach. An overlay opened from the
 * document belongs in the document's story root, never in that shadow root, where it is unstyled and out of the
 * document's reach.
 */
describe('overlays opened inside a framed document', () => {
  const framedDocument = () => {
    const sheet = document.createElement('style'); sheet.setAttribute('data-mx-tw', ''); document.head.append(sheet);
    const story = document.createElement('div'); story.setAttribute('data-mx-inline-story', '');
    const host = document.createElement('div'); story.append(host);
    const trusted = document.createElement('div'); trusted.setAttribute('data-trusted-ui', '');
    const portal = document.createElement('div'); trusted.attachShadow({ mode: 'open' }).append(portal);
    document.body.append(story, trusted);
    const inDocument = (selector: string) => story.querySelector(selector);
    return { story, host, portal, inDocument, island: { ...fakeIsland(), trustedPortal: () => portal }, cleanup: () => { sheet.remove(); story.remove(); trusted.remove(); } };
  };

  it('renders a served (forceMount) Popover\'s content in the document when it opens, and back in place when it closes', () => {
    const page = framedDocument();
    const dispose = render(() => <IslandProvider value={page.island}><Popover><PopoverTrigger>Open popover</PopoverTrigger><PopoverContent forceMount>Popover body</PopoverContent></Popover></IslandProvider>, page.host);
    try {
      const content = page.host.querySelector('[data-slot="popover-content"]');
      page.host.querySelector<HTMLButtonElement>('button')!.click();
      expect(page.host.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
      expect(page.inDocument('[data-slot="popover-content"]')).toBe(content);
      expect(page.inDocument('[data-radix-popper-content-wrapper]')?.closest('[hidden]')).toBeNull();
      expect(page.portal.querySelector('[data-slot="popover-content"]')).toBeNull();
      content!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(page.host.querySelector('[data-slot="popover-content"]')).toBe(content);
    } finally { dispose(); page.cleanup(); }
  });

  it('renders an unserved Popover\'s content in the document', () => {
    const page = framedDocument();
    const dispose = render(() => <IslandProvider value={page.island}><Popover><PopoverTrigger>Open popover</PopoverTrigger><PopoverContent>Popover body</PopoverContent></Popover></IslandProvider>, page.host);
    try {
      page.host.querySelector<HTMLButtonElement>('button')!.click();
      expect(page.inDocument('[data-slot="popover-content"]')?.textContent).toBe('Popover body');
      expect(page.portal.querySelector('[data-slot="popover-content"]')).toBeNull();
    } finally { dispose(); page.cleanup(); }
  });

  it('renders a served (forceMount) Tooltip\'s content in the document', () => {
    const page = framedDocument();
    const dispose = render(() => <IslandProvider value={page.island}><Tooltip><TooltipTrigger>Target</TooltipTrigger><TooltipContent forceMount>Tooltip body</TooltipContent></Tooltip></IslandProvider>, page.host);
    try {
      const content = page.host.querySelector('[data-slot="tooltip-content"]');
      page.host.querySelector<HTMLButtonElement>('button')!.focus();
      expect(page.inDocument('[data-slot="tooltip-content"]')).toBe(content);
      expect(page.portal.querySelector('[data-slot="tooltip-content"]')).toBeNull();
    } finally { dispose(); page.cleanup(); }
  });

  it('opens a Dialog in the document', () => {
    const page = framedDocument();
    const dispose = render(() => <IslandProvider value={page.island}><Dialog><DialogTrigger>Open dialog</DialogTrigger><DialogContent aria-label="Framed dialog">Dialog body</DialogContent></Dialog></IslandProvider>, page.host);
    try {
      page.host.querySelector<HTMLButtonElement>('button')!.click();
      expect(page.inDocument('dialog')?.textContent).toBe('Dialog body');
      expect(page.portal.querySelector('dialog')).toBeNull();
    } finally { dispose(); page.cleanup(); }
  });
});
