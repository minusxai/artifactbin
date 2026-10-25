// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { registerInput } from './input';

const preUpgrade = document.createElement('af-input') as HTMLElement & { value: string | number | null };
preUpgrade.value = 'from-property';
registerInput();
afterEach(() => document.body.replaceChildren());
const input = (markup: string) => { const host = document.createElement('div'); host.innerHTML = markup; document.body.append(host); return host.querySelector('af-input')! as HTMLElement & {value: string | number | null}; };

describe('af-input', () => {
  it('uses an uncontrolled default and emits cancelable text intent without taking ownership', () => {
    const root = input('<af-input label="Full name" default-value="Ada"></af-input>');
    const native = root.querySelector('input')!;
    expect(native.value).toBe('Ada');
    expect(native.labels?.[0]?.textContent).toBe('Full name');
    let detail: unknown; let composed = false;
    root.addEventListener('af-change', event => { detail = (event as CustomEvent).detail; composed = event.composed; });
    native.value = 'Grace'; native.dispatchEvent(new Event('input', { bubbles: true }));
    expect(detail).toEqual({ value: 'Grace' }); expect(composed).toBe(true);
    expect(root.getAttribute('default-value')).toBe('Ada');
  });
  it('keeps controlled values until the author updates them and restores canceled edits', () => {
    const root = input('<af-input value="one"></af-input>'); const native = root.querySelector('input')!;
    native.value = 'two'; native.dispatchEvent(new Event('input', { bubbles: true }));
    expect(native.value).toBe('one');
    root.setAttribute('value', 'three'); expect(native.value).toBe('three');
  });
  it('keeps controlled input intent pending until the author reflects it, including synchronous reflection', () => {
    const root = input('<af-input value="old"></af-input>'); const native = root.querySelector('input')!;
    native.value = 'pending'; native.dispatchEvent(new Event('input', {bubbles:true}));
    expect(native.value).toBe('old'); expect(root.value).toBe('old');
    root.addEventListener('af-change', event => { root.setAttribute('value', String((event as CustomEvent<{value:string|null}>).detail.value)); }, {once:true});
    native.value = 'accepted'; native.dispatchEvent(new Event('input', {bubbles:true}));
    expect(native.value).toBe('accepted'); expect(root.value).toBe('accepted');
  });
  it('supports property control, number null coercion, native constraints and safe labels', () => {
    const root = input('<af-input type="number" label="&lt;img src=x&gt;" min="2" max="4" step="1" required></af-input>');
    const native = root.querySelector('input')!;
    expect(native.type).toBe('number'); expect(native.min).toBe('2'); expect(native.max).toBe('4'); expect(native.required).toBe(true);
    expect(root.querySelector('label')!.querySelector('img')).toBeNull();
    expect(native.checkValidity()).toBe(false);
    let detail: unknown; root.addEventListener('af-change', event => detail = (event as CustomEvent).detail);
    native.value = '3'; native.dispatchEvent(new Event('input', { bubbles: true })); expect(detail).toEqual({ value: 3 });
    (root as HTMLElement & { value: string | number | null }).value = 4;
    expect(native.value).toBe('4');
    native.value = ''; native.dispatchEvent(new Event('input', { bubbles: true })); expect(detail).toEqual({ value: null });
  });
  it('forwards native attributes, preserves native node and caret on same-value sync, and reconnects once', () => {
    const root = input('<af-input id="authored" name="email" type="bogus" placeholder="mail" autofocus disabled readonly></af-input>');
    const native = root.querySelector('input')!;
    expect(root.id).toBe('authored'); expect(native.type).toBe('text'); expect(native.name).toBe('email');
    expect(native.placeholder).toBe('mail'); expect(native.autofocus).toBe(true); expect(native.disabled).toBe(true); expect(native.readOnly).toBe(true);
    native.value = 'hello'; native.setSelectionRange(2, 2); root.setAttribute('placeholder', 'new');
    expect(root.querySelector('input')).toBe(native); expect(native.value).toBe('hello'); expect(native.selectionStart).toBe(2);
    root.removeAttribute('disabled'); root.removeAttribute('readonly');
    root.remove(); document.body.append(root); let count = 0; root.addEventListener('af-change', () => count++);
    native.value = 'hello again';
    native.dispatchEvent(new Event('input', { bubbles: true })); expect(count).toBe(1);
    root.setAttribute('disabled', ''); expect(native.disabled).toBe(true);
  });
  it('keeps the uncontrolled accepted value across reconnect for later canceled and readonly edits', () => {
    const root = input('<af-input default-value="initial"></af-input>'); const native = root.querySelector('input')!;
    native.value = 'accepted'; native.dispatchEvent(new Event('input', {bubbles:true}));
    root.remove(); document.body.append(root);
    root.addEventListener('af-change', event => event.preventDefault());
    native.value = 'rejected'; native.dispatchEvent(new Event('input', {bubbles:true}));
    expect(native.value).toBe('accepted');
    root.setAttribute('readonly', ''); native.value = 'blocked'; native.dispatchEvent(new Event('input', {bubbles:true}));
    expect(native.value).toBe('accepted');
  });
  it('restores canceled uncontrolled edits and adopts a pre-upgrade property', () => {
    const root = input('<af-input default-value="initial"></af-input>'); const native = root.querySelector('input')!;
    root.addEventListener('af-change', event => event.preventDefault());
    native.value = 'rejected'; native.dispatchEvent(new Event('input', { bubbles:true })); expect(native.value).toBe('initial');
    document.body.append(preUpgrade); expect(preUpgrade.querySelector('input')!.value).toBe('from-property');
  });
  it('returns a numeric value attribute as a number and reports an empty text value as null', () => {
    const numeric = input('<af-input type="number" value="12.5"></af-input>');
    expect(numeric.value).toBe(12.5);
    const empty = input('<af-input value="something"></af-input>'); let detail: unknown;
    empty.addEventListener('af-change', event => detail = (event as CustomEvent).detail);
    const emptyNative = empty.querySelector('input')!; emptyNative.value = '';
    emptyNative.dispatchEvent(new Event('input', {bubbles:true}));
    expect(detail).toEqual({value:null});
  });
  it('does not emit for disabled or readonly synthetic input events', () => {
    const root = input('<af-input value="author" disabled></af-input>'); const native = root.querySelector('input')!; let count = 0;
    root.addEventListener('af-change', () => count++);
    native.value = 'disabled'; native.dispatchEvent(new Event('input', {bubbles:true}));
    root.removeAttribute('disabled'); root.setAttribute('readonly', '');
    native.value = 'readonly'; native.dispatchEvent(new Event('input', {bubbles:true}));
    expect(count).toBe(0); expect(native.value).toBe('author');
  });
  it('keeps aria-only labels accessible without rendering visible label text', () => {
    const root = input('<af-input aria-label="Search"></af-input>'); const label = root.querySelector('label')!;
    expect(label.htmlFor).toBe(root.querySelector('input')!.id);
    expect(label.textContent).toBe('Search'); expect(label.classList.contains('af-visually-hidden')).toBe(true);
  });
  it('uses the authored 1.5 line-height for visible field labels', () => {
    const root=input('<af-input label="Full name"></af-input>');
    expect(getComputedStyle(root.querySelector('label')!).lineHeight).toBe('1.5');
  });
});
