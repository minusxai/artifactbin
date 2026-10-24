// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { AfTabs, registerTabs } from './tabs';
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
  it('keeps nested instances independent', () => {
    const outer = fixture('default-value="a"'); const inner = fixture('default-value="a"');
    outer.panels[0]!.append(inner.root); inner.triggers[1]!.click();
    expect(outer.root.value).toBe('a'); expect(inner.root.value).toBe('b');
    registerTabs();
    expect(document.querySelectorAll('style[data-af-tabs-styles]')).toHaveLength(1);
  });
});
