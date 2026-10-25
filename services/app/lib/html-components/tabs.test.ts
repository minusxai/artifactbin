// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { AfTabs, registerTabs, tabsStyles } from './tabs';
const preUpgradeHost = document.createElement('div');
preUpgradeHost.innerHTML = '<af-tabs><af-tabs-list><af-tabs-trigger id="authored-tab" value="a">A</af-tabs-trigger><af-tabs-trigger id="authored-tab" value="b">B</af-tabs-trigger></af-tabs-list><af-tabs-content value="b">B</af-tabs-content></af-tabs>';
const preUpgradeRoot = preUpgradeHost.firstElementChild as AfTabs;
Object.defineProperty(preUpgradeRoot, 'value', {value:'b',writable:true,configurable:true});
registerTabs();
afterEach(() => document.body.replaceChildren());
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
function fixture(attrs = '') {
  const host = document.createElement('div');
  host.innerHTML = `<af-tabs ${attrs}><af-tabs-list><af-tabs-trigger value="a">A</af-tabs-trigger><af-tabs-trigger value="b">B</af-tabs-trigger><af-tabs-trigger value="c" disabled>C</af-tabs-trigger></af-tabs-list><af-tabs-content value="a"><input data-af-id="authored"></af-tabs-content><af-tabs-content value="b" force-mount>B panel</af-tabs-content></af-tabs>`;
  document.body.append(host);
  const root = host.firstElementChild as AfTabs;
  return { root, triggers: [...root.querySelectorAll<HTMLElement>('af-tabs-trigger')], panels: [...root.querySelectorAll<HTMLElement>('af-tabs-content')] };
}
function shadowFixture(attrs = '') {
  const host = document.createElement('div');
  const shadow = host.attachShadow({mode:'open'});
  shadow.innerHTML = `<af-tabs ${attrs}><af-tabs-list><af-tabs-trigger value="a">A</af-tabs-trigger><af-tabs-trigger value="b">B</af-tabs-trigger><af-tabs-trigger value="c" disabled>C</af-tabs-trigger></af-tabs-list></af-tabs>`;
  document.body.append(host);
  const root = shadow.querySelector('af-tabs') as AfTabs;
  return {host, shadow, root, triggers:[...root.querySelectorAll<HTMLElement>('af-tabs-trigger')]};
}
describe('native authored tabs', () => {
  it('preserves panels and authored identity, links unique ARIA ids, and emits intent', () => {
    const {root, triggers, panels} = fixture('default-value="a"');
    const input = panels[0]!.firstChild;
    const events: string[] = [];
    root.addEventListener('af-change', e => events.push((e as CustomEvent).detail.value));
    triggers[1]!.click();
    expect(root.value).toBe('b');
    expect(events).toEqual(['b']);
    expect(panels[0]!.hidden).toBe(true);
    expect(panels[0]!.hasAttribute('inert')).toBe(true);
    expect(panels[0]!.firstChild).toBe(input);
    expect(triggers[0]!.getAttribute('aria-controls')).toBe(panels[0]!.id);
    expect(new Set([...triggers, ...panels].map(e => e.id)).size).toBe(5);
  });
  it('waits for controlled author updates and supports canceled intent', () => {
    const {root, triggers, panels} = fixture('value="a"');
    triggers[1]!.click();
    expect(root.value).toBe('a');
    root.value = 'b';
    expect(panels[1]!.hidden).toBe(false);
    root.removeAttribute('value'); root.value = undefined;
    root.addEventListener('af-change', e => e.preventDefault());
    triggers[0]!.click();
    expect(root.value).toBe('b');
  });
  it('automatically selects an enabled trigger on focus and emits one intent per keyboard move', () => {
    const {root, triggers} = fixture('value="a"');
    const events: string[] = [];
    root.addEventListener('af-change', event => events.push((event as CustomEvent).detail.value));

    triggers[1]!.focus();
    expect(events).toEqual(['b']);
    expect(root.value).toBe('a');
    triggers[0]!.focus();
    expect(events).toEqual(['b']);
    triggers[1]!.click();
    expect(events).toEqual(['b', 'b']);
    root.value = 'b';

    triggers[1]!.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
    expect(document.activeElement).toBe(triggers[0]);
    expect(events).toEqual(['b', 'b', 'a']);
  });
  it('does not activate disabled triggers on focus and retains manual activation', () => {
    const automatic = fixture('default-value="a"');
    automatic.triggers[2]!.focus();
    expect(automatic.root.value).toBe('a');

    const manual = fixture('default-value="a" activation-mode="manual"');
    manual.triggers[1]!.focus();
    expect(manual.root.value).toBe('a');
  });
  it('does not duplicate focus-then-click or reentrant activation intents', () => {
    const pointer = fixture('value="a"');
    const pointerIntents: string[] = [];
    pointer.root.addEventListener('af-change', event => pointerIntents.push((event as CustomEvent).detail.value));
    pointer.triggers[1]!.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
    pointer.triggers[1]!.focus();
    pointer.triggers[1]!.dispatchEvent(new MouseEvent('click', {bubbles:true, detail:1}));
    expect(pointerIntents).toEqual(['b']);

    const reentrant = fixture('value="a"');
    reentrant.triggers[1]!.focus();
    let count = 0;
    reentrant.root.addEventListener('af-change', () => {
      count++;
      if (count === 1) reentrant.triggers[1]!.click();
    });
    reentrant.triggers[1]!.click();
    expect(count).toBe(1);
  });
  it('recognizes an already-focused trigger inside a shadow root when click has no focusin to trigger activation', () => {
    const {host, shadow, root, triggers} = shadowFixture('value="a"');
    const intents: string[] = [];
    root.addEventListener('af-change', event => intents.push((event as CustomEvent).detail.value));
    triggers[1]!.addEventListener('focusin', event => event.stopPropagation(), {once:true});

    triggers[1]!.focus();
    expect(document.activeElement).toBe(host);
    expect(shadow.activeElement).toBe(triggers[1]);
    triggers[1]!.click();
    expect(intents).toEqual(['b']);
    expect(triggers[1]!.tabIndex).toBe(0);
  });
  it('keeps automatic, manual and disabled focus behavior inside a shadow root without duplicate pointer intent', () => {
    const automatic = shadowFixture('value="a"');
    const automaticIntents: string[] = [];
    automatic.root.addEventListener('af-change', event => automaticIntents.push((event as CustomEvent).detail.value));
    automatic.triggers[1]!.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
    automatic.triggers[1]!.focus();
    expect(automatic.shadow.activeElement).toBe(automatic.triggers[1]);
    expect(automatic.triggers[1]!.tabIndex).toBe(0);
    expect(automaticIntents).toEqual(['b']);
    automatic.triggers[1]!.dispatchEvent(new MouseEvent('click', {bubbles:true, detail:1}));
    expect(automaticIntents).toEqual(['b']);

    const manual = shadowFixture('default-value="a" activation-mode="manual"');
    const manualIntents: string[] = [];
    manual.root.addEventListener('af-change', event => manualIntents.push((event as CustomEvent).detail.value));
    manual.triggers[1]!.focus();
    expect(manual.shadow.activeElement).toBe(manual.triggers[1]);
    expect(manual.triggers[1]!.tabIndex).toBe(0);
    expect(manual.root.value).toBe('a');
    expect(manualIntents).toEqual([]);

    manual.triggers[2]!.focus();
    expect(manual.root.value).toBe('a');
    expect(manualIntents).toEqual([]);
  });
  it('separates manual focus from selection and respects RTL, boundaries and disabled tabs', () => {
    const {root, triggers} = fixture('default-value="a" activation-mode="manual" dir="rtl" loop="false"');
    triggers[0]!.focus();
    triggers[0]!.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowLeft', bubbles:true}));
    expect(document.activeElement).toBe(triggers[1]); expect(root.value).toBe('a');
    triggers[1]!.dispatchEvent(new KeyboardEvent('keydown', {key:'End', bubbles:true}));
    expect(document.activeElement).toBe(triggers[1]);
    triggers[1]!.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
    expect(root.value).toBe('b');
  });
  it('repairs disabled/removal focus and reconnects without duplicate handlers', async () => {
    const {root,triggers} = fixture('default-value="a"');
    triggers[0]!.setAttribute('disabled',''); await tick();
    expect(triggers[1]!.tabIndex).toBe(0);
    root.remove(); document.body.append(root); await tick();
    let count = 0; root.addEventListener('af-change', () => count++);
    triggers[1]!.click(); expect(count).toBe(1);
    triggers[1]!.remove(); await tick();
    expect(root.querySelector('af-tabs-trigger[tabindex="0"]')).toBeNull();
  });
  it('handles vertical automatic navigation, loops, and controlled attribute updates', async () => {
    const {root, triggers, panels} = fixture('value="a" orientation="vertical"');
    let detail: unknown; let composed = false;
    root.addEventListener('af-change', event => { detail = (event as CustomEvent).detail; composed = event.composed; });
    triggers[0]!.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown', bubbles:true}));
    expect(detail).toEqual({value:'b'}); expect(composed).toBe(true);
    expect(root.value).toBe('a'); expect(document.activeElement).toBe(triggers[1]);
    root.setAttribute('value','b'); expect(panels[1]!.hidden).toBe(false);
    triggers[1]!.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown', bubbles:true}));
    expect(document.activeElement).toBe(triggers[0]);
    triggers[2]!.removeAttribute('disabled'); await tick();
    triggers[0]!.dispatchEvent(new KeyboardEvent('keydown', {key:'End', bubbles:true}));
    expect(document.activeElement).toBe(triggers[2]);
    triggers[2]!.setAttribute('disabled',''); await tick();
    expect(triggers[2]!.tabIndex).toBe(-1);
  });
  it('honors canceled native events, disabled intent, and a nonlooping edge', () => {
    const {root, triggers} = fixture('default-value="b" loop="false"');
    triggers[1]!.focus();
    const right = new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true, cancelable:true});
    triggers[1]!.dispatchEvent(right);
    expect(document.activeElement).toBe(triggers[1]); expect(root.value).toBe('b');
    triggers[2]!.click(); expect(root.value).toBe('b');
    triggers[0]!.addEventListener('click', event => event.preventDefault());
    triggers[0]!.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}));
    expect(root.value).toBe('b');
    const canceled = new KeyboardEvent('keydown', {key:'Home', bubbles:true, cancelable:true});
    canceled.preventDefault(); triggers[1]!.dispatchEvent(canceled);
    expect(document.activeElement).toBe(triggers[1]);
  });
  it('moves the controlled Tab entry to selection outside the list, while retaining live manual focus', () => {
    const {root,triggers} = fixture('value="a" activation-mode="manual"');
    root.value = 'b'; expect(triggers[1]!.tabIndex).toBe(0);
    triggers[0]!.focus(); root.value = 'b'; expect(triggers[0]!.tabIndex).toBe(0);
  });
  it('supports inherited RTL and Home without a default selection', () => {
    const {root,triggers,panels} = fixture();
    expect(root.value).toBeUndefined(); expect(panels.every(panel => panel.hidden)).toBe(true);
    root.parentElement!.dir = 'rtl'; triggers[0]!.focus();
    triggers[0]!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
    expect(root.value).toBe('b');
    triggers[1]!.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));
    expect(root.value).toBe('a'); expect(document.activeElement).toBe(triggers[0]);
  });
  it('honors a pre-upgrade value and preserves authored IDs even if duplicated', () => {
    const root = preUpgradeRoot; document.body.append(preUpgradeHost);
    expect(root.value).toBe('b'); expect(root.querySelector('af-tabs-content')!.hasAttribute('hidden')).toBe(false);
    expect([...root.querySelectorAll('af-tabs-trigger')].map(node => node.id)).toEqual(['authored-tab','authored-tab']);
  });
  it('provides compact recipe sizing and vertical list layout through installed CSS', () => {
    const {root,triggers} = fixture('default-value="a" orientation="vertical" variant="line"');
    const list = root.querySelector('af-tabs-list')!;
    expect(getComputedStyle(triggers[0]!).fontSize).toBe('14px');
    expect(getComputedStyle(triggers[0]!).fontWeight).toBe('500');
    expect(getComputedStyle(list).flexDirection).toBe('column');
    root.setAttribute('orientation','horizontal');
    expect(getComputedStyle(list).height).toBe('36px');
  });
  it('implements the source ring as a two pixel focus ring without an outline offset', () => {
    expect(tabsStyles).toContain('outline:2px solid transparent;outline-offset:2px;box-shadow:0 0 0 2px');
    expect(tabsStyles).not.toContain('outline:2px solid color-mix');
    expect(tabsStyles.indexOf('af-tabs-trigger:focus-visible')).toBeGreaterThan(tabsStyles.indexOf('af-tabs-trigger[data-state=active]'));
  });
  it('keeps nested instances independent', () => {
    const outer = fixture('default-value="a"'); const inner = fixture('default-value="a"');
    outer.panels[0]!.append(inner.root); inner.triggers[1]!.click();
    expect(outer.root.value).toBe('a'); expect(inner.root.value).toBe('b');
    registerTabs();
    expect(document.querySelectorAll('style[data-af-tabs-styles]')).toHaveLength(1);
  });
});
