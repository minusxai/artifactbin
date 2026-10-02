/* @jsxImportSource solid-js */
import { useIsland } from '../context';
import { createContext, createEffect, createSignal, createUniqueId, on, onCleanup, onMount, splitProps, untrack, useContext, type JSX } from 'solid-js';

/**
 * Radix Tabs, as the retired React kit rendered and ran it (over @radix-ui/react-tabs and
 * its roving focus group). The served markup is Radix's server render; what Radix changes once it runs,
 * this changes the same way and at the same moment:
 *  - the tablist is `tabindex=-1` until its tabs have mounted, then `0` (and `-1` again while a Shift+Tab
 *    leaves it); a keyboard focus on it moves to the active tab;
 *  - a tab becomes the group's tab stop (`tabindex=0`) once it is pressed or focused;
 *  - a tab activates on a primary mouse press, Enter/Space, or focus (automatic activation);
 *  - the panel that was active on mount carries `animation-duration: 0s` until the first frame, and its
 *    later renders clear it (`style=""`), exactly as React writes it.
 */
type TabsState = {
  value: () => string; setValue: (value: string) => void; orientation: 'horizontal' | 'vertical';
  triggerId: (value: string) => string; contentId: (value: string) => string;
  registerTrigger: (value: string, id: string) => void; registerContent: (value: string, id: string) => void;
  /** Enabled tabs mounted (Radix's focusable item count). */
  focusable: () => number; addFocusable: () => () => void;
  /** The value of the tab that is the group's tab stop, once one has been pressed or focused. */
  tabStop: () => string | null; setTabStop: (value: string) => void;
};
const Context = createContext<TabsState>();
const state = () => { const value = useContext(Context); if (!value) throw new Error('Tabs child outside Tabs'); return value; };

export function Tabs(props: JSX.HTMLAttributes<HTMLDivElement> & { value?: string; defaultValue?: string; orientation?: 'horizontal' | 'vertical'; onValueChange?: (value: string) => void }) {
  const [local, setLocal] = createSignal(props.defaultValue ?? '');
  const rootId = createUniqueId();
  const orientation = props.orientation ?? 'horizontal';
  const [triggerIds, setTriggerIds] = createSignal<Record<string, string>>({});
  const [contentIds, setContentIds] = createSignal<Record<string, string>>({});
  const [focusable, setFocusable] = createSignal(0);
  const [tabStop, setTabStop] = createSignal<string | null>(null);
  const ctx: TabsState = {
    value: () => props.value ?? local(), setValue: next => { if (next === untrack(ctx.value)) return; setLocal(next); props.onValueChange?.(next); }, orientation,
    triggerId: value => triggerIds()[value] ?? `${rootId}-trigger-${value}`,
    contentId: value => contentIds()[value] ?? `${rootId}-content-${value}`,
    registerTrigger: (value, id) => setTriggerIds(ids => ({ ...ids, [value]: id })),
    registerContent: (value, id) => setContentIds(ids => ({ ...ids, [value]: id })),
    focusable, addFocusable: () => { setFocusable(n => n + 1); return () => setFocusable(n => n - 1); },
    tabStop, setTabStop,
  };
  const [localProps, rest] = splitProps(props, ['value', 'defaultValue', 'orientation', 'onValueChange', 'children']);
  return <Context.Provider value={ctx}><div data-slot="tabs" data-orientation={orientation} dir="ltr" class="group/tabs flex gap-2 data-[orientation=horizontal]:flex-col" {...rest}>{localProps.children}</div></Context.Provider>;
}

const enabledTabs = (list: HTMLElement) => [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])')];
/** Radix focusFirst: the first candidate that takes focus, unless focus is already on one before it. */
const focusFirst = (candidates: (HTMLElement | undefined)[]) => {
  const previous = document.activeElement;
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate === previous) return;
    candidate.focus();
    if (document.activeElement !== previous) return;
  }
};

export function TabsList(props: JSX.HTMLAttributes<HTMLDivElement> & { variant?: string; loop?: boolean }) {
  const ctx = state();
  const { variant = 'default', loop: _loop, onKeyDown: _onKeyDown, ...rest } = props;
  const [tabbingBackOut, setTabbingBackOut] = createSignal(false);
  let clickFocus = false;
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Tab' && event.shiftKey) { setTabbingBackOut(true); return; }
    const forward = ctx.orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
    const backward = ctx.orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
    const first = event.key === 'Home' || event.key === 'PageUp'; const last = event.key === 'End' || event.key === 'PageDown';
    if (event.key !== forward && event.key !== backward && !first && !last) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const tabs = enabledTabs(event.currentTarget as HTMLDivElement);
    const current = tabs.findIndex(tab => tab === document.activeElement || tab.dataset.state === 'active');
    const next = first ? 0 : last ? tabs.length - 1 : (current + (event.key === forward ? 1 : -1) + tabs.length) % tabs.length;
    if (tabs[next]) { event.preventDefault(); tabs[next].focus(); tabs[next].click(); }
  };
  const onFocusIn = (event: FocusEvent) => {
    const list = event.currentTarget as HTMLDivElement;
    if (event.target === list && !clickFocus && !tabbingBackOut()) {
      const tabs = enabledTabs(list);
      focusFirst([tabs.find(tab => tab.dataset.state === 'active'), tabs.find(tab => tab.tabIndex === 0), ...tabs]);
    }
    clickFocus = false;
  };
  return <div role="tablist" aria-orientation={ctx.orientation} data-orientation={ctx.orientation} tabIndex={tabbingBackOut() || ctx.focusable() === 0 ? -1 : 0} style="outline:none" data-slot="tabs-list" data-variant={variant} {...rest}
    on:keydown={onKey} on:mousedown={() => { clickFocus = true; }} on:focusin={onFocusIn} on:focusout={() => setTabbingBackOut(false)} />;
}

export function TabsTrigger(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) {
  const ctx = state(); const { value, onClick: _onClick, ...rest } = props;
  if (props.id) ctx.registerTrigger(value, props.id);
  const active = () => ctx.value() === value;
  const enabled = () => !props.disabled;
  let button!: HTMLButtonElement;
  onMount(() => {
    if (enabled()) onCleanup(ctx.addFocusable());
    // A panel registers its own id after this tab rendered; while hydrating, Solid leaves the served
    // attribute alone, so the tab names its panel here, once the page is live.
    button.setAttribute('aria-controls', ctx.contentId(value));
  });
  const press = (event: MouseEvent) => {
    if (!enabled()) { event.preventDefault(); return; }
    ctx.setTabStop(value);
    if (event.button === 0 && !event.ctrlKey) ctx.setValue(value); else event.preventDefault();
  };
  const key = (event: KeyboardEvent) => { if (enabled() && event.target === event.currentTarget && (event.key === ' ' || event.key === 'Enter')) ctx.setValue(value); };
  const focus = () => { ctx.setTabStop(value); if (!active() && enabled()) ctx.setValue(value); };
  return <button ref={button} type="button" role="tab" aria-selected={active()} aria-controls={ctx.contentId(value)} data-state={active() ? 'active' : 'inactive'} data-orientation={ctx.orientation} data-radix-collection-item="" data-slot="tabs-trigger"
    id={props.id ?? ctx.triggerId(value)} tabIndex={ctx.tabStop() === value ? 0 : -1} {...rest}
    on:mousedown={press} on:keydown={key} on:focus={focus} on:click={() => ctx.setValue(value)} />;
}

export function TabsContent(props: JSX.HTMLAttributes<HTMLDivElement> & { value: string; forceMount?: boolean }) {
  const ctx = state(); const island = useIsland();
  // `children` stays behind splitProps' lazy getter: destructuring it with `...rest` would build the panel's
  // content (a Question, a chart) once up front, outside the panel's hydration context, and that copy would
  // mount into a detached tree (its engine deferral then read `documentElement` of an inert template document).
  const [local, rest] = splitProps(props, ['value', 'forceMount', 'style', 'children']);
  const value = local.value; const authorStyle = local.style; const active = () => ctx.value() === value; let panel!: HTMLDivElement;
  if (props.id) ctx.registerContent(value, props.id);
  // Radix's isMountAnimationPreventedRef: true for the panel active on mount, false from the first frame.
  let prevented = untrack(active);
  // Each later render writes `animationDuration` as React does: only when it changed, and '' to clear it.
  let written: string | undefined = prevented ? '0s' : undefined;
  const rerender = () => {
    const next = prevented ? '0s' : undefined;
    if (next !== written) panel.style.animationDuration = next ?? '';
    written = next;
  };
  // The former reader re-renders the whole story when the document's query results land in the browser,
  // after the first frame: an active panel then drops its mount style (`style=""`). A compiled page
  // serves those results, so its store never lands them; a document that runs queries is re-rendered
  // here, once, at the same point — a document without queries keeps the mount style, as it did in the former reader.
  const runsQueries = island.declaresQueries();
  onMount(() => {
    const frame = requestAnimationFrame(() => { prevented = false; if (runsQueries) rerender(); });
    onCleanup(() => cancelAnimationFrame(frame));
  });
  createEffect(on(ctx.value, rerender, { defer: true }));
  // As an attribute: served as React serves it, and left alone while hydrating.
  const served = [typeof authorStyle === 'string' ? authorStyle : '', prevented ? 'animation-duration:0s' : ''].filter(Boolean).join(';') || undefined;
  return <div ref={panel} data-state={active() ? 'active' : 'inactive'} data-orientation={ctx.orientation} role="tabpanel" aria-labelledby={ctx.triggerId(value)} data-slot="tabs-content" id={props.id ?? ctx.contentId(value)} tabIndex={0} hidden={!active()} {...rest} {...({ 'attr:style': served } as JSX.HTMLAttributes<HTMLDivElement>)}>{local.forceMount ? local.children : active() ? local.children : null}</div>;
}
