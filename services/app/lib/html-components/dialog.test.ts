// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it } from 'vitest';
import { AfDialog, registerDialog } from './dialog';
const preUpgrade = document.createElement('af-dialog') as AfDialog;
preUpgrade.innerHTML = '<af-dialog-content><input value="kept"></af-dialog-content>';
Object.defineProperty(preUpgrade,'open',{value:true,writable:true,configurable:true});
// jsdom does not implement native top-layer methods. Focus trapping is browser-tested.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')); };
  registerDialog();
});
afterEach(() => document.body.replaceChildren());
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
function fixture(attrs = '') {
  const host = document.createElement('div');
  host.innerHTML = `<af-dialog ${attrs}><af-dialog-trigger>Open</af-dialog-trigger><af-dialog-content data-af-id="content"><af-dialog-header><af-dialog-title>Title</af-dialog-title><af-dialog-description>Description</af-dialog-description></af-dialog-header><input data-af-id="field"><af-dialog-footer><af-dialog-close>Close</af-dialog-close></af-dialog-footer></af-dialog-content></af-dialog>`;
  document.body.append(host);
  const root = host.firstElementChild as AfDialog;
  return { root, trigger: root.querySelector<HTMLElement>('af-dialog-trigger')!, close: root.querySelector<HTMLElement>('af-dialog-close')!, native: root.querySelector('dialog')!, content: root.querySelector<HTMLElement>('af-dialog-content')! };
}
it('retains authored nodes, values and identities across opening and closing', () => {
  const {root,trigger,close,native,content} = fixture();
  const input = root.querySelector('input')!; input.value = 'retained';
  trigger.click(); expect(root.open).toBe(true); expect(native.open).toBe(true);
  close.click(); expect(root.open).toBe(false); expect(native.open).toBe(false);
  expect(root.querySelector('input')).toBe(input); expect(input.value).toBe('retained'); expect(content.dataset.afId).toBe('content');
});
it('waits for controlled properties and presence attributes, and permits canceling requests', () => {
  const {root,trigger,close,native} = fixture('open');
  close.click(); expect(native.open).toBe(true);
  root.open = false; trigger.click(); expect(native.open).toBe(false);
  root.open = undefined; root.removeAttribute('open');
  root.addEventListener('af-change', e => { expect(e.composed && e.bubbles && e.cancelable).toBe(true); expect((e as CustomEvent).detail).toEqual({value:true}); e.preventDefault(); });
  trigger.click(); expect(native.open).toBe(false);
});
it('routes native cancellation and backdrop through the same cancelable intent', () => {
  const {root,native} = fixture('default-open'); const values: boolean[] = [];
  root.addEventListener('af-change', e => { values.push((e as CustomEvent).detail.value); e.preventDefault(); });
  const cancel = new Event('cancel', {cancelable:true}); native.dispatchEvent(cancel);
  native.click(); expect(cancel.defaultPrevented).toBe(true); expect(native.open).toBe(true); expect(values).toEqual([false,false]);
});
it('links labels with unique IDs and updates changed children while respecting authored IDs', async () => {
  const a = fixture(); const b = fixture(); const title = a.root.querySelector('af-dialog-title')!;
  expect(a.native.getAttribute('aria-labelledby')).toBe(title.id); expect(title.id).not.toBe(b.root.querySelector('af-dialog-title')!.id);
  title.id = 'authored'; await tick(); expect(a.native.getAttribute('aria-labelledby')).toBe('authored');
  title.remove(); await tick(); expect(a.native.hasAttribute('aria-labelledby')).toBe(false);
});
it('respects disabled controls, reconnects once, restores focus, and tolerates removed triggers', async () => {
  const {root,trigger,close} = fixture(); trigger.setAttribute('disabled',''); trigger.click(); expect(root.open).toBe(false);
  trigger.removeAttribute('disabled'); root.remove(); document.body.append(root); await tick();
  let count = 0; root.addEventListener('af-change', () => count++);
  trigger.focus(); trigger.click(); close.click(); expect(count).toBe(2); expect(document.activeElement).toBe(trigger);
  trigger.click(); trigger.remove(); close.click(); expect(root.open).toBe(false);
});
it('keeps nested instances independent and registers styles only once', () => {
  const outer = fixture('default-open'); const inner = fixture(); outer.content.append(inner.root);
  inner.trigger.click(); inner.close.click(); expect(outer.root.open).toBe(true); expect(inner.root.open).toBe(false);
  registerDialog(); expect(document.querySelectorAll('style[data-af-dialog-styles]')).toHaveLength(1);
});
it('honors properties supplied before upgrade and only reads default-open initially', () => {
  document.body.append(preUpgrade); expect(preUpgrade.open).toBe(true); expect(preUpgrade.querySelector('dialog')!.open).toBe(true);
  const {root,close} = fixture('default-open'); close.click(); root.remove(); document.body.append(root);
  expect(root.open).toBe(false); root.setAttribute('default-open',''); expect(root.open).toBe(false);
});
it('supports keyboard controls and native form closure through author intent', () => {
  const {root,trigger,native} = fixture();
  trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})); expect(root.open).toBe(true);
  root.addEventListener('af-change', e => e.preventDefault()); native.close(); expect(root.open).toBe(true); expect(native.open).toBe(true);
});
it('uses a native child as the single control and restores its authored disabled state', async () => {
  const {root,trigger} = fixture(); trigger.innerHTML = '<button>Native</button>'; await tick();
  const button = trigger.querySelector('button')!;
  expect(trigger.hasAttribute('role')).toBe(false); expect(trigger.hasAttribute('tabindex')).toBe(false);
  expect(button.getAttribute('aria-haspopup')).toBe('dialog');
  trigger.setAttribute('disabled',''); await tick(); expect(button.disabled).toBe(true); button.click(); expect(root.open).toBe(false);
  trigger.removeAttribute('disabled'); await tick(); expect(button.disabled).toBe(false);
  button.disabled = true; trigger.setAttribute('disabled',''); await tick(); trigger.removeAttribute('disabled'); await tick(); expect(button.disabled).toBe(true);
  trigger.replaceChildren('Plain'); await tick(); trigger.setAttribute('disabled',''); await tick(); expect(trigger.tabIndex).toBe(-1);
});
it('styles only a nested native trigger button like the text-only trigger and preserves disabled/focus behavior', async () => {
  const {root,trigger} = fixture();
  trigger.innerHTML = '<button>Native</button>'; await tick();
  const button = trigger.querySelector('button')!;
  const textOnly = document.createElement('af-dialog-trigger'); textOnly.textContent = 'Plain'; document.body.append(textOnly);
  const nestedStyle = getComputedStyle(button); const textStyle = getComputedStyle(textOnly);
  for (const property of ['display','paddingTop','paddingRight','paddingBottom','paddingLeft','fontSize','fontWeight','background','color','borderRadius','cursor'] as const) {
    expect(nestedStyle[property], property).toBe(textStyle[property]);
  }
  const unrelated = document.createElement('button'); unrelated.textContent = 'Content action'; root.querySelector('af-dialog-content')!.append(unrelated);
  expect(getComputedStyle(unrelated).display).not.toBe(nestedStyle.display);
  trigger.setAttribute('disabled',''); await tick();
  expect(button.disabled).toBe(true); expect(getComputedStyle(button).opacity).toBe('0.5'); expect(getComputedStyle(button).cursor).toBe('default');
  trigger.removeAttribute('disabled'); await tick(); button.focus();
  expect(document.activeElement).toBe(button);
});
it('styles a nested native close button like the text-only close control without styling dialog content buttons', async () => {
  const {root,close} = fixture();
  close.innerHTML = '<button>Close</button>'; await tick();
  const button = close.querySelector('button')!;
  const textOnly = document.createElement('af-dialog-close'); textOnly.textContent = 'Text close'; document.body.append(textOnly);
  const nestedStyle = getComputedStyle(button); const textStyle = getComputedStyle(textOnly);
  for (const property of ['display','paddingTop','paddingRight','paddingBottom','paddingLeft','fontSize','fontWeight','background','color','borderTopWidth','borderTopStyle','borderRadius','cursor'] as const) {
    expect(nestedStyle[property], property).toBe(textStyle[property]);
  }
  const unrelated = document.createElement('button'); root.querySelector('af-dialog-content')!.append(unrelated);
  const bareStyle=getComputedStyle(document.createElement('button'));
  expect(getComputedStyle(unrelated).borderTopStyle).toBe(bareStyle.borderTopStyle);
  expect(getComputedStyle(unrelated).paddingTop).toBe(bareStyle.paddingTop);
});
it('matches the retained bare dialog heading and outline close styling', () => {
  const {root,content} = fixture();
  const heading = document.createElement('h2'); heading.textContent = 'Bare heading'; content.append(heading);
  const style = document.querySelector<HTMLStyleElement>('style[data-af-dialog-styles]')!;
  const css = style.textContent!.replace(/\s+/g,'');
  expect(getComputedStyle(heading).fontSize).toBe('28px');
  expect(getComputedStyle(heading).lineHeight).toBe('1.2');
  expect(css).toContain('af-dialog-close{border:1pxsolidcurrentColor;background:var(--background);color:var(--foreground);box-shadow:var(--shadow-xs,');
  expect(css).toContain('af-dialog-close>button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:.5rem;border:1pxsolidcurrentColor');
  document.documentElement.dataset.afDark = 'true';
  expect(css).toContain(':root[data-af-dark="true"]af-dialog-close,:root[data-af-dark="true"]af-dialog-close>button{border-color:var(--input);background:color-mix(inoklab,var(--input)30%,transparent)}');
  delete document.documentElement.dataset.afDark;
  root.remove();
});
it('uses the themed three-pixel focus ring on keyboard-focused dialog controls', () => {
  const {root,close} = fixture();
  root.style.setProperty('--ring','rgb(12, 34, 56)');
  close.focus();
  expect(document.activeElement).toBe(close);
  expect(getComputedStyle(close).getPropertyValue('--ring')).toBe('rgb(12, 34, 56)');
  const focusRule = document.querySelector<HTMLStyleElement>('style[data-af-dialog-styles]')!.textContent!
    .replace(/\s+/g,'');
  expect(focusRule).toContain('af-dialog-trigger:focus-visible,af-dialog-close:focus-visible,af-dialog-trigger>button:focus-visible,af-dialog-close>button:focus-visible{outline:none;border-color:var(--ring);box-shadow:0003pxcolor-mix(inoklab,var(--ring)50%,transparent)}');
  root.remove();
});
it('disposes an open native modal on content removal and accepts replacement content', async () => {
  const {root,trigger,content,native} = fixture(); trigger.focus(); trigger.click(); content.remove(); await tick();
  expect(native.open).toBe(false); expect(native.isConnected).toBe(false); expect(document.activeElement).toBe(trigger);
  const replacement = document.createElement('af-dialog-content'); replacement.textContent = 'Replacement'; root.append(replacement); await tick();
  const next = root.querySelector('dialog')!; expect(next).not.toBe(native); expect(next.contains(replacement)).toBe(true); expect(next.open).toBe(true);
  const simultaneous = document.createElement('af-dialog-content'); replacement.replaceWith(simultaneous); await tick();
  expect(next.open).toBe(false); expect(next.isConnected).toBe(false); expect(root.querySelector('dialog')!.contains(simultaneous)).toBe(true);
});
it('wraps modal Tab navigation around authored controls and handles a modal without stops', () => {
 const {trigger,close,native,root} = fixture(); trigger.click(); close.focus();
 const tab = new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}); close.dispatchEvent(tab);
 expect(tab.defaultPrevented).toBe(true); const input = root.querySelector('input')!; expect(document.activeElement).toBe(input);
 input.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true})); expect(document.activeElement).toBe(close);
 root.querySelector('input')!.disabled = true; close.setAttribute('disabled',''); native.focus(); native.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})); expect(document.activeElement).toBe(native);
});
it('projects authored accessible labels with native precedence and restores derived labels dynamically', async () => {
  const { root, content, native, trigger } = fixture();
  const title = root.querySelector('af-dialog-title')!;
  const description = root.querySelector('af-dialog-description')!;
  title.id = 'authored-title'; description.id = 'authored-description';
  content.setAttribute('aria-label', 'Explicit name'); await tick();
  expect(native.getAttribute('aria-label')).toBe('Explicit name');
  expect(native.hasAttribute('aria-labelledby')).toBe(false);
  content.setAttribute('aria-labelledby', 'external-title authored-title');
  content.setAttribute('aria-describedby', 'external-description'); await tick();
  expect(native.getAttribute('aria-labelledby')).toBe('external-title authored-title');
  expect(native.getAttribute('aria-describedby')).toBe('external-description');
  expect(native.getAttribute('aria-label')).toBe('Explicit name');
  content.removeAttribute('aria-labelledby'); await tick(); expect(native.hasAttribute('aria-labelledby')).toBe(false);
  content.removeAttribute('aria-label'); content.removeAttribute('aria-describedby'); await tick();
  expect(native.hasAttribute('aria-label')).toBe(false);
  expect(native.getAttribute('aria-labelledby')).toBe('authored-title');
  expect(native.getAttribute('aria-describedby')).toBe('authored-description');
  expect(title.id).toBe('authored-title'); expect(description.id).toBe('authored-description');
  expect(content.dataset.afId).toBe('content'); trigger.click(); expect(native.open).toBe(true);
  expect(native.localName).toBe('dialog'); expect(native.hasAttribute('role')).toBe(false);
});
it('keeps an authored name without title parts and does not manufacture missing ID targets', async () => {
  const { root, content, native } = fixture();
  root.querySelector('af-dialog-title')!.remove(); root.querySelector('af-dialog-description')!.remove();
  content.setAttribute('aria-label', 'Fallback name'); await tick();
  expect(native.getAttribute('aria-label')).toBe('Fallback name'); expect(native.hasAttribute('aria-labelledby')).toBe(false);
  content.setAttribute('aria-labelledby', 'missing-authored-id'); await tick();
  expect(native.getAttribute('aria-labelledby')).toBe('missing-authored-id');
  expect(root.querySelector('#missing-authored-id')).toBeNull();
  content.removeAttribute('aria-labelledby'); await tick(); expect(native.getAttribute('aria-label')).toBe('Fallback name');
});
