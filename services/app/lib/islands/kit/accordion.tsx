/* @jsxImportSource solid-js */
import { createContext, createEffect, createSignal, createUniqueId, onMount, splitProps, useContext, type JSX } from 'solid-js';
import { collapsibleStyle } from './collapsible-style';
import { commentSignal, commentStateKey } from '../comment-state';

type Root = { value: () => string; toggle: (value: string) => void; disabled: boolean; orientation: string };
type Item = { value: string; open: () => boolean; disabled: boolean; triggerId: () => string; contentId: string; panelId: () => string; setPanelId: (id: string) => void; setTriggerId: (id: string) => void };
const RootContext = createContext<Root>(); const ItemContext = createContext<Item>();
const root = () => { const ctx = useContext(RootContext); if (!ctx) throw new Error('Accordion outside root'); return ctx; };
const item = () => { const ctx = useContext(ItemContext); if (!ctx) throw new Error('Accordion outside item'); return ctx; };
export function Accordion(props: JSX.HTMLAttributes<HTMLDivElement> & { type?: 'single' | 'multiple'; value?: string; defaultValue?: string; collapsible?: boolean; disabled?: boolean; orientation?: string; onValueChange?: (value: string) => void }) {
  const [local, setLocal] = commentSignal(props.value === undefined ? commentStateKey('value', props.id) : null, props.defaultValue ?? '');
  const ctx: Root = { value: () => props.value ?? local(), toggle: next => { const value = ctx.value() === next && props.collapsible ? '' : next; setLocal(value); props.onValueChange?.(value); }, disabled: !!props.disabled, orientation: props.orientation ?? 'vertical' };
  const [localProps, rest] = splitProps(props, ['type', 'value', 'defaultValue', 'collapsible', 'disabled', 'orientation', 'onValueChange', 'children']);
  return <RootContext.Provider value={ctx}><div data-slot="accordion" data-orientation={ctx.orientation} {...rest}>{localProps.children}</div></RootContext.Provider>;
}
export function AccordionItem(props: JSX.HTMLAttributes<HTMLDivElement> & { value: string; disabled?: boolean }) {
  const owner = root(); const generated = createUniqueId(); const [localProps, rest] = splitProps(props, ['value', 'disabled', 'children']); const value = localProps.value;
  const [panelId, setPanelId] = createSignal(`${generated}-content`); const [triggerId, setTriggerId] = createSignal(`${generated}-trigger`);
  const ctx: Item = { value, open: () => owner.value() === value, disabled: owner.disabled || !!props.disabled, triggerId, contentId: `${generated}-content`, panelId, setPanelId, setTriggerId };
  return <ItemContext.Provider value={ctx}><div data-slot="accordion-item" data-state={ctx.open() ? 'open' : 'closed'} data-orientation={owner.orientation} {...rest}>{localProps.children}</div></ItemContext.Provider>;
}
export function AccordionTrigger(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  const owner = root(); const ctx = item(); let button!: HTMLButtonElement;
  // The content's aria-labelledby names the element that is really in the document: an author's id replaces the generated one.
  if (props.id) ctx.setTriggerId(props.id);
  // Radix names the OPEN content; this names the real element (an author's id replaces Radix's), once live.
  onMount(() => createEffect(() => { const id = ctx.open() ? ctx.panelId() : null; if (id) button.setAttribute('aria-controls', id); else button.removeAttribute('aria-controls'); }));
  return <h3 class="flex" data-orientation={owner.orientation} data-state={ctx.open() ? 'open' : 'closed'}><button ref={button} type="button" aria-controls={ctx.open() ? ctx.panelId() : undefined} aria-expanded={ctx.open()} data-state={ctx.open() ? 'open' : 'closed'} data-orientation={owner.orientation} data-radix-collection-item="" data-slot="accordion-trigger" id={props.id ?? ctx.triggerId()} disabled={ctx.disabled} on:click={() => owner.toggle(ctx.value)} {...props}>{props.children}<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="pointer-events-none size-4 shrink-0 translate-y-0.5 text-muted-foreground transition-transform duration-200"><path d="m6 9 6 6 6-6" /></svg></button></h3>;
}
export function AccordionContent(props: JSX.HTMLAttributes<HTMLDivElement> & { forceMount?: boolean }) {
  const ctx = item(); const [local, rest] = splitProps(props, ['class', 'forceMount', 'children']); const resolvedClass = local.class; let node: HTMLDivElement | undefined; // splitProps keeps `children` lazy (see TabsContent)
  if (props.id) ctx.setPanelId(props.id);
  collapsibleStyle(() => node, ctx.open);
  return <div ref={node} data-state={ctx.open() ? 'open' : 'closed'} data-orientation="vertical" data-slot="accordion-content" style="--radix-accordion-content-height:var(--radix-collapsible-content-height);--radix-accordion-content-width:var(--radix-collapsible-content-width)" role="region" aria-labelledby={ctx.triggerId()} id={props.id ?? ctx.contentId} hidden={!ctx.open()} class="overflow-hidden text-sm data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down" {...rest}>{local.forceMount || ctx.open() ? <div class={resolvedClass}>{local.children}</div> : null}</div>;
}
