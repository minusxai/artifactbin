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
});
