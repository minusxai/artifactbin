// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { registerTextarea } from './textarea';

registerTextarea();
afterEach(() => document.body.replaceChildren());
const textarea = (markup: string) => { const host = document.createElement('div'); host.innerHTML = markup; document.body.append(host); return host.querySelector('af-textarea')!; };

describe('af-textarea', () => {
  it('uses authored child text as the default and keeps authored children and identity', () => {
    const root = textarea('<af-textarea label="Notes">First line\nsecond line</af-textarea>');
    const native = root.querySelector('textarea')!; const child = native.firstChild;
    expect(native.value).toBe('First line\nsecond line'); expect(native.rows).toBe(3); expect(native.labels?.[0]?.textContent).toBe('Notes');
    native.value = 'edited'; native.dispatchEvent(new Event('input', { bubbles: true }));
    expect(native.value).toBe('edited'); expect(native.firstChild).toBe(child);
  });
  it('reflects controlled values without replacing the native textarea and restores canceled edits', () => {
    const root = textarea('<af-textarea value="before" rows="5" resize="none"></af-textarea>'); const native = root.querySelector('textarea')!;
    expect(native.rows).toBe(5); expect(getComputedStyle(native).resize).toBe('none');
    root.addEventListener('af-change', event => event.preventDefault());
    native.value = 'after'; native.dispatchEvent(new Event('input', { bubbles: true })); expect(native.value).toBe('before');
    root.setAttribute('value', 'updated'); expect(native.value).toBe('updated');
  });
  it('forwards constraints and emits composed string intent once after composition', () => {
    const root = textarea('<af-textarea required minlength="2" maxlength="8" readonly disabled></af-textarea>'); const native = root.querySelector('textarea')!;
    expect(native.required).toBe(true); expect(native.minLength).toBe(2); expect(native.maxLength).toBe(8); expect(native.readOnly).toBe(true); expect(native.disabled).toBe(true);
    native.disabled = false; native.readOnly = false;
    const events: unknown[] = []; root.addEventListener('af-change', event => events.push((event as CustomEvent).detail));
    native.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    native.value = 'é'; native.dispatchEvent(new Event('input', { bubbles: true }));
    native.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    expect(events).toEqual([{ value: 'é' }]);
  });
  it('keeps the native value and caret stable across unrelated attribute updates', () => {
    const root = textarea('<af-textarea placeholder="write"></af-textarea>'); const native = root.querySelector('textarea')!;
    native.value = 'hello'; native.setSelectionRange(3, 3); root.setAttribute('placeholder', 'more');
    expect(root.querySelector('textarea')).toBe(native); expect(native.value).toBe('hello'); expect(native.selectionStart).toBe(3);
  });
  it('does not overwrite a composing draft during external updates and emits one final intent', async () => {
    const root = textarea('<af-textarea value="start"></af-textarea>'); const native = root.querySelector('textarea')!;
    const events: unknown[] = []; root.addEventListener('af-change', event => events.push((event as CustomEvent).detail));
    native.dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true}));
    native.value = 'draft'; native.dispatchEvent(new Event('input', {bubbles:true}));
    root.setAttribute('value', 'server');
    expect(native.value).toBe('draft');
    native.dispatchEvent(new CompositionEvent('compositionend', {bubbles:true}));
    await Promise.resolve(); await Promise.resolve();
    expect(events).toEqual([{value:'draft'}]); expect(native.value).toBe('server');
  });
  it('deduplicates the trailing input after composition for uncontrolled and reflected controlled values', () => {
    const uncontrolled = textarea('<af-textarea default-value="start"></af-textarea>');
    const native = uncontrolled.querySelector('textarea')!; const uncontrolledEvents: unknown[] = [];
    uncontrolled.addEventListener('af-change', event => uncontrolledEvents.push((event as CustomEvent).detail));
    native.dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true}));
    native.value = 'draft'; native.dispatchEvent(new InputEvent('input', {bubbles:true, isComposing:true}));
    native.dispatchEvent(new CompositionEvent('compositionend', {bubbles:true}));
    native.dispatchEvent(new InputEvent('input', {bubbles:true, isComposing:false}));
    expect(uncontrolledEvents).toEqual([{value:'draft'}]); expect(native.value).toBe('draft');

    const controlled = textarea('<af-textarea value="start"></af-textarea>');
    const controlledNative = controlled.querySelector('textarea')!; const controlledEvents: unknown[] = [];
    controlled.addEventListener('af-change', event => {
      const detail = (event as CustomEvent<{value:string|null}>).detail;
      controlledEvents.push(detail); controlled.setAttribute('value', detail.value ?? '');
    });
    controlledNative.dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true}));
    controlledNative.value = 'reflected'; controlledNative.dispatchEvent(new InputEvent('input', {bubbles:true, isComposing:true}));
    controlledNative.dispatchEvent(new CompositionEvent('compositionend', {bubbles:true}));
    controlledNative.dispatchEvent(new InputEvent('input', {bubbles:true, isComposing:false}));
    expect(controlledEvents).toEqual([{value:'reflected'}]); expect(controlledNative.value).toBe('reflected');
  });
});

// Retained control shell: 11px label and 14px field both use normal (1.5) leading.
it('keeps label and multiline row leading at the retained control proportions',()=>{
 const root=textarea('<af-textarea label="Notes" rows="4"></af-textarea>'),native=root.querySelector('textarea')!,label=root.querySelector('label')!;
 const field=getComputedStyle(native),caption=getComputedStyle(label);
 expect(caption.fontSize).toBe('11px');expect(caption.lineHeight).toBe('1.5');
 expect(field.fontSize).toBe('14px');expect(field.lineHeight).toBe('1.5');
 expect(parseFloat(field.fontSize)*parseFloat(field.lineHeight)*native.rows).toBe(84);
 expect(getComputedStyle(root).gap).toBe('0.375rem');
});
