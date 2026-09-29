/* @jsxImportSource solid-js */
import { describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../kit/accordion';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../kit/disclosure';

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
});
