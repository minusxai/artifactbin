// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { AfCollapsible, registerCollapsible } from './collapsible';

const preUpgradeHost = document.createElement('div');
preUpgradeHost.innerHTML = '<af-collapsible><af-collapsible-trigger>Open</af-collapsible-trigger><af-collapsible-content>Body</af-collapsible-content></af-collapsible>';
const preUpgradeRoot = preUpgradeHost.firstElementChild as AfCollapsible;
Object.defineProperty(preUpgradeRoot, 'open', {value:true,writable:true,configurable:true});
registerCollapsible();
afterEach(() => document.body.replaceChildren());
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
function fixture(attrs = '', body = '<p data-af-id="authored">Body</p>') {
  const host = document.createElement('div');
  host.innerHTML = `<af-collapsible ${attrs}><af-collapsible-trigger>Toggle</af-collapsible-trigger><af-collapsible-content>${body}</af-collapsible-content></af-collapsible>`;
  document.body.append(host);
  const root = host.firstElementChild as AfCollapsible;
  return {root, trigger:root.querySelector<HTMLElement>('af-collapsible-trigger')!, content:root.querySelector<HTMLElement>('af-collapsible-content')!};
}
describe('native authored collapsible', () => {
  it('keeps closed content mounted and preserves authored identity while wiring accessible trigger state', () => {
    const {root,trigger,content} = fixture(); const child = content.firstChild;
    expect(root.open).toBe(false); expect(content.hidden).toBe(true); expect(content.hasAttribute('inert')).toBe(true);
    expect(trigger.getAttribute('role')).toBe('button'); expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-controls')).toBe(content.id); expect(content.firstChild).toBe(child);
    expect(content.querySelector('[data-af-id="authored"]')).not.toBeNull();
    trigger.click(); expect(root.open).toBe(true); expect(content.hidden).toBe(false); expect(content.hasAttribute('inert')).toBe(false);
  });
  it('uses default-open only as the uncontrolled initial value and emits cancelable bubbling intent', () => {
    const {root,trigger} = fixture('default-open');
    let event: CustomEvent<{value:boolean}> | undefined; let bubbled = false;
    root.addEventListener('af-change', e => { event=e as CustomEvent<{value:boolean}>; });
    document.body.addEventListener('af-change', () => { bubbled=true; }, {once:true});
    trigger.click();
    expect(root.open).toBe(false); expect(event?.detail).toEqual({value:false});
    expect(event?.bubbles).toBe(true); expect(event?.composed).toBe(true); expect(event?.cancelable).toBe(true); expect(bubbled).toBe(true);
  });
  it('keeps property and attribute controlled values until the author reflects a change', () => {
    const {root,trigger,content} = fixture('open');
    trigger.click(); expect(root.open).toBe(true); expect(content.hidden).toBe(false);
    root.open = false; expect(root.open).toBe(false); expect(root.hasAttribute('open')).toBe(true); expect(content.hidden).toBe(true);
    root.removeAttribute('open'); expect(root.open).toBe(false);
    root.open = true; expect(root.hasAttribute('open')).toBe(false); expect(content.hidden).toBe(false);
  });
  it('supports uncontrolled toggles, canceled changes, and disabled root or trigger', () => {
    const {root,trigger,content} = fixture();
    root.addEventListener('af-change', e => e.preventDefault(), {once:true}); trigger.click();
    expect(root.open).toBe(false); expect(content.hidden).toBe(true);
    root.removeEventListener('af-change', () => {});
    root.setAttribute('disabled',''); trigger.click(); expect(root.open).toBe(false);
    root.removeAttribute('disabled'); trigger.setAttribute('disabled',''); trigger.click(); expect(root.open).toBe(false);
  });
  it('handles Enter and Space once, ignores native descendant key activation, and respects canceled key events', () => {
    const {root,trigger} = fixture();
    const inner = document.createElement('button'); inner.id = 'inner'; inner.textContent = 'Inner'; trigger.append(inner);
    let changes = 0; root.addEventListener('af-change', () => changes++);
    trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    expect(root.open).toBe(true); expect(changes).toBe(1);
    trigger.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}));
    expect(root.open).toBe(false); expect(changes).toBe(2);
    const canceled = new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}); canceled.preventDefault(); trigger.dispatchEvent(canceled);
    expect(root.open).toBe(false); expect(changes).toBe(2);
    inner.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    expect(root.open).toBe(false); expect(changes).toBe(2);
    inner.click(); expect(root.open).toBe(true); expect(changes).toBe(3);
  });
  it('uses an authored native button as the only semantic and focus control', async () => {
    const {root,trigger,content} = fixture('', '<p>Body</p>');
    const button = document.createElement('button'); button.id = 'native-trigger'; button.textContent = 'Open'; button.setAttribute('tabindex','3'); trigger.replaceChildren(button);
    await tick();
    expect(trigger.hasAttribute('role')).toBe(false); expect(trigger.hasAttribute('tabindex')).toBe(false);
    expect(button.hasAttribute('role')).toBe(false); expect(button.tabIndex).toBe(3);
    expect(button.getAttribute('aria-expanded')).toBe('false'); expect(button.getAttribute('aria-controls')).toBe(content.id);
    button.click(); expect(root.open).toBe(true); expect(button.getAttribute('aria-expanded')).toBe('true');
  });
  it('temporarily disables native trigger buttons while preserving their authored disabled and tabindex state', async () => {
    const {root,trigger} = fixture('', '<p>Body</p>');
    const originalEnabled = document.createElement('button'); originalEnabled.textContent = 'Enabled'; originalEnabled.setAttribute('tabindex','4');
    const originalDisabled = document.createElement('button'); originalDisabled.textContent = 'Disabled'; originalDisabled.setAttribute('disabled',''); originalDisabled.setAttribute('tabindex','2');
    trigger.replaceChildren(originalEnabled,originalDisabled);
    root.setAttribute('disabled','');
    expect(originalEnabled.disabled).toBe(true); expect(originalEnabled.getAttribute('tabindex')).toBe('4');
    expect(originalDisabled.disabled).toBe(true); expect(originalDisabled.getAttribute('tabindex')).toBe('2');
    let changes = 0; root.addEventListener('af-change', () => changes++);
    originalEnabled.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); expect(changes).toBe(0);
    root.removeAttribute('disabled');
    expect(originalEnabled.disabled).toBe(false); expect(originalEnabled.getAttribute('tabindex')).toBe('4');
    expect(originalDisabled.disabled).toBe(true); expect(originalDisabled.getAttribute('tabindex')).toBe('2');
    trigger.setAttribute('disabled',''); await tick(); expect(originalEnabled.disabled).toBe(true);
    trigger.removeAttribute('disabled'); await tick(); expect(originalEnabled.disabled).toBe(false);
  });
  it('captures native disabled state at the moment the wrapper becomes disabled', async () => {
    const {root,trigger} = fixture('', '<p>Body</p>');
    const button = document.createElement('button'); trigger.append(button); await tick();
    button.disabled = true; await tick();
    root.setAttribute('disabled',''); expect(button.disabled).toBe(true);
    root.removeAttribute('disabled'); expect(button.disabled).toBe(true);
    button.disabled = false; await tick();
    root.setAttribute('disabled',''); root.removeAttribute('disabled'); expect(button.disabled).toBe(false);
  });
  it('settles its disabled mutation observer for a native trigger button', async () => {
    const NativeObserver = globalThis.MutationObserver;
    const observerRuns: number[] = [];
    class BoundedMutationObserver extends NativeObserver {
      constructor(callback: MutationCallback) {
        let runs = 0;
        super((records, observer) => {
          runs++;
          observerRuns[0] = runs;
          if (runs <= 4) callback(records,observer);
          else observer.disconnect();
        });
      }
    }
    globalThis.MutationObserver = BoundedMutationObserver;
    try {
      const {root,trigger} = fixture('', '<p>Body</p>');
      const button = document.createElement('button'); trigger.append(button); await tick();
      observerRuns[0] = 0;
      root.setAttribute('disabled',''); await tick(); await tick();
      expect(observerRuns[0]).toBeLessThanOrEqual(2);
    } finally {
      globalThis.MutationObserver = NativeObserver;
      document.body.replaceChildren();
    }
  });
  it('isolates nested roots, responds to external attributes and child changes, and reconnects cleanly', async () => {
    const {root,trigger,content} = fixture();
    const nested = document.createElement('af-collapsible'); nested.innerHTML='<af-collapsible-trigger>Nested</af-collapsible-trigger><af-collapsible-content>N</af-collapsible-content>';
    content.append(nested); const nestedTrigger = nested.querySelector<HTMLElement>('af-collapsible-trigger')!;
    nestedTrigger.click(); expect((nested as AfCollapsible).open).toBe(true); expect(root.open).toBe(false);
    root.setAttribute('open',''); await tick(); expect(content.hidden).toBe(false);
    const extra = document.createElement('af-collapsible-trigger'); extra.textContent='Extra'; root.append(extra); await tick();
    expect(extra.getAttribute('aria-controls')).toBe(content.id);
    root.remove(); document.body.append(root); await tick();
    let changes = 0; root.addEventListener('af-change', () => changes++); trigger.click(); expect(changes).toBe(1);
    extra.remove(); await tick(); expect(extra.isConnected).toBe(false); expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });
  it('honors pre-upgrade open properties and authored IDs, and registration stays idempotent', () => {
    document.body.append(preUpgradeHost);
    const root = preUpgradeRoot; const trigger = root.querySelector('af-collapsible-trigger')!; const content = root.querySelector('af-collapsible-content')!;
    trigger.id = 'authored-trigger'; content.id = 'authored-content';
    root.remove(); document.body.append(root);
    expect(root.open).toBe(true); expect(trigger.id).toBe('authored-trigger'); expect(content.id).toBe('authored-content');
    expect(trigger.getAttribute('aria-controls')).toBe('authored-content');
    registerCollapsible(); expect(document.querySelectorAll('style[data-af-collapsible-styles]')).toHaveLength(1);
  });
  it('installs compact light DOM styles from semantic tokens', () => {
    const {trigger,content} = fixture();
    expect(getComputedStyle(trigger).display).toBe('inline-flex');
    expect(getComputedStyle(content).display).toBe('none');
    trigger.click(); expect(getComputedStyle(content).display).toBe('block');
  });
});
