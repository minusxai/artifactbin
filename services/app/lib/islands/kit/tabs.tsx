/* @jsxImportSource solid-js */
import { createContext, createEffect, createSignal, createUniqueId, splitProps, useContext, type JSX } from 'solid-js';

type TabsState = { value: () => string; setValue: (value: string) => void; orientation: 'horizontal' | 'vertical'; rootId: string; triggerId: (value: string) => string; contentId: (value: string) => string };
const Context = createContext<TabsState>();
const state = () => { const value = useContext(Context); if (!value) throw new Error('Tabs child outside Tabs'); return value; };

export function Tabs(props: JSX.HTMLAttributes<HTMLDivElement> & { value?: string; defaultValue?: string; orientation?: 'horizontal' | 'vertical'; onValueChange?: (value: string) => void }) {
  const [local, setLocal] = createSignal(props.defaultValue ?? '');
  const rootId = createUniqueId();
  const orientation = props.orientation ?? 'horizontal';
  const ctx: TabsState = { value: () => props.value ?? local(), setValue: next => { setLocal(next); props.onValueChange?.(next); }, orientation, rootId, triggerId: value => `${rootId}-trigger-${value}`, contentId: value => `${rootId}-content-${value}` };
  const [localProps, rest] = splitProps(props, ['value', 'defaultValue', 'orientation', 'onValueChange', 'children']);
  return <Context.Provider value={ctx}><div data-slot="tabs" data-orientation={orientation} dir="ltr" class="group/tabs flex gap-2 data-[orientation=horizontal]:flex-col" {...rest}>{localProps.children}</div></Context.Provider>;
}
export function TabsList(props: JSX.HTMLAttributes<HTMLDivElement> & { variant?: string; loop?: boolean }) {
  const ctx = state();
  const { variant = 'default', loop: _loop, onKeyDown: _onKeyDown, ...rest } = props;
  const onKey = (event: KeyboardEvent) => {
    const forward = ctx.orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
    const backward = ctx.orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
    if (event.key !== forward && event.key !== backward && event.key !== 'Home' && event.key !== 'End') return;
    const tabs = [...(event.currentTarget as HTMLDivElement).querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])')];
    const current = tabs.findIndex(tab => tab === document.activeElement || tab.dataset.state === 'active');
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === forward ? 1 : -1) + tabs.length) % tabs.length;
    if (tabs[next]) { event.preventDefault(); tabs[next].focus(); tabs[next].click(); }
  };
  return <div role="tablist" aria-orientation={ctx.orientation} data-orientation={ctx.orientation} tabIndex={-1} style="outline:none" data-slot="tabs-list" data-variant={variant} {...rest} on:keydown={onKey} />;
}
export function TabsTrigger(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) {
  const ctx = state(); const { value, onClick: _onClick, ...rest } = props;
  const active = () => ctx.value() === value;
  return <button type="button" role="tab" aria-selected={active()} aria-controls={ctx.contentId(value)} data-state={active() ? 'active' : 'inactive'} data-orientation={ctx.orientation} data-radix-collection-item="" data-slot="tabs-trigger" id={props.id ?? ctx.triggerId(value)} tabIndex={-1} {...rest} on:click={() => ctx.setValue(value)} />;
}
export function TabsContent(props: JSX.HTMLAttributes<HTMLDivElement> & { value: string; forceMount?: boolean }) {
  const ctx = state(); const { value, forceMount: _forceMount, ...rest } = props; const active = () => ctx.value() === value; let panel!: HTMLDivElement;
  createEffect(() => { if (active()) panel.setAttribute('style', 'animation-duration:0s'); else panel.removeAttribute('style'); });
  return <div ref={panel} data-state={active() ? 'active' : 'inactive'} data-orientation={ctx.orientation} role="tabpanel" aria-labelledby={ctx.triggerId(value)} data-slot="tabs-content" id={props.id ?? ctx.contentId(value)} tabIndex={0} hidden={!active()} {...rest}>{active() ? props.children : null}</div>;
}
