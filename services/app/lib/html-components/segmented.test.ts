// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { AfSegmented, registerSegmented, segmentedStyles, type SegmentedOption } from './segmented';

registerSegmented();
afterEach(() => document.body.replaceChildren());
function fixture(attrs = '', options: readonly (string | number | boolean | null | SegmentedOption)[] = ['S', 'M', 'L']) {
  const host = document.createElement('div'); const element = document.createElement('af-segmented') as AfSegmented;
  for (const token of attrs.split(/\s+/).filter(Boolean)) { const [key, ...rest] = token.split('='); element.setAttribute(key!, rest.join('=')); }
  if (!element.hasAttribute('label')) element.setAttribute('label', 'Size');
  element.options = options; host.append(element); document.body.append(host); return element;
}
const buttons = (element: AfSegmented) => [...element.querySelectorAll<HTMLButtonElement>('button[data-segment-option]')];

describe('native authored segmented control', () => {
  it('renders its caption and names the group without duplicating option names', () => {
    const control = fixture();
    const caption = control.querySelector<HTMLElement>('.af-segmented-label');
    expect(caption?.textContent).toBe('Size');
    expect(caption?.hidden).toBe(false);
    expect(control.getAttribute('role')).toBe('group');
    expect(control.getAttribute('aria-label')).toBe('Size');
    expect(buttons(control).map(button => [button.textContent, button.getAttribute('aria-label')]))
      .toEqual([['S', null], ['M', null], ['L', null]]);

    control.setAttribute('label', 'Width');
    expect(caption?.textContent).toBe('Width');
    control.setAttribute('aria-label', 'Dimensions');
    expect(caption?.textContent).toBe('Width');
    expect(control.getAttribute('aria-label')).toBe('Dimensions');
    control.removeAttribute('aria-label');
    expect(control.getAttribute('aria-label')).toBe('Width');
    control.removeAttribute('label');
    expect(caption?.hidden).toBe(true);
    expect(control.hasAttribute('aria-label')).toBe(false);
  });

  it('supports scalar and labeled options, default selection, and stable option nodes', () => {
    const control = fixture('default-value=M', ['S', {value:'M', label:'Medium'}, 'L']);
    const before = buttons(control);
    expect(control.getAttribute('role')).toBe('group'); expect(before.map(button => button.textContent)).toEqual(['S', 'Medium', 'L']);
    expect(before.map(button => button.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    before[0]!.click(); expect(control.value).toBe('S');
    expect(buttons(control)[1]).toBe(before[1]);
  });
  it('supports explicit nullable All options and typed option values', () => {
    const control = fixture('default-value=', [null, {value: 1, label: 'One'}, true]);
    expect(buttons(control).map(button => button.textContent)).toEqual(['All', 'One', 'true']);
    expect(control.value).toBeNull(); buttons(control)[1]!.click(); expect(control.value).toBe(1);
  });
  it('keeps controlled selections until the author updates value and emits cancelable intent', () => {
    const control = fixture('value=M'); let seen: unknown;
    control.addEventListener('af-change', event => { const custom = event as CustomEvent; seen = custom.detail; custom.preventDefault(); });
    const event = new Event('click', {bubbles:true}); buttons(control)[0]!.dispatchEvent(event);
    expect(seen).toEqual({value:'S'}); expect(control.value).toBe('M');
    control.value = 'S'; expect(control.value).toBe('S');
  });
  it('keeps canceled uncontrolled intent unchanged and reflects attribute updates', () => {
    const control = fixture('default-value=M'); let count = 0; let detail: unknown; let flags: boolean[] = [];
    control.addEventListener('af-change', event => { const custom = event as CustomEvent; count++; detail = custom.detail; flags = [custom.bubbles, custom.composed, custom.cancelable]; custom.preventDefault(); });
    buttons(control)[0]!.click();
    expect(count).toBe(1); expect(detail).toEqual({value:'S'}); expect(flags).toEqual([true, true, true]);
    expect(control.value).toBe('M');
    control.setAttribute('value', 'L'); expect(control.value).toBe('L');
    control.removeAttribute('value'); expect(control.value).toBe('M');
  });
  it('supports roving focus, orientation-aware arrows, Home and End, and disabled state', () => {
    const control = fixture('default-value=M orientation=vertical disabled'); const options = buttons(control);
    expect(control.defaultValue).toBe('M'); expect(control.value).toBe('M');
    expect(options.every(button => button.disabled)).toBe(true);
    control.disabled = false; options[1]!.focus();
    options[1]!.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown', bubbles:true, cancelable:true}));
    expect(document.activeElement).toBe(options[2]);
    options[2]!.dispatchEvent(new KeyboardEvent('keydown', {key:'Home', bubbles:true, cancelable:true}));
    expect(document.activeElement).toBe(options[0]);
    options[0]!.dispatchEvent(new KeyboardEvent('keydown', {key:'End', bubbles:true, cancelable:true}));
    expect(document.activeElement).toBe(options[2]);
  });
  it('preserves option nodes through reorder, removes missing options, and deduplicates typed values', () => {
    const control = fixture('', ['a', 'a', 'b', 2, '2']);
    const initial = buttons(control); expect(initial).toHaveLength(4);
    control.options = ['b', 'a', 2, '2'];
    expect(buttons(control)).toEqual([initial[1], initial[0], initial[2], initial[3]]);
    expect(buttons(control).map(button => button.textContent)).toEqual(['b', 'a', '2', '2']);
    control.options = ['a']; expect(buttons(control)).toEqual([initial[0]]);
  });
  it('keeps typed defaultValue values without string round trips', () => {
    const control = document.createElement('af-segmented') as AfSegmented;
    control.options = [2, '2', false, null];
    for (const expected of [2, '2', false, null]) { control.defaultValue = expected; expect(control.defaultValue).toBe(expected); }
  });
  it('ignores nested segmented buttons and removes a mapped label cleanly', () => {
    const outer = fixture('label=Outer'); const inner = document.createElement('af-segmented') as AfSegmented;
    inner.options = ['inside', 'other']; outer.append(inner); document.body.append(outer);
    const before = outer.value; buttons(inner)[0]!.click(); expect(outer.value).toBe(before);
    outer.setAttribute('label', 'Updated'); expect(outer.getAttribute('aria-label')).toBe('Updated');
    outer.removeAttribute('label'); expect(outer.hasAttribute('aria-label')).toBe(false);
  });
  it('reverses horizontal arrow navigation in RTL', () => {
    const control = fixture('default-value=M dir=rtl'); const options = buttons(control);
    options[1]!.focus(); options[1]!.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true, cancelable:true}));
    expect(document.activeElement).toBe(options[0]);
  });
  it('preserves authored children and data-af-id, reconnects cleanly, and registers styles once', () => {
    const control = fixture('default-value=M'); const authored = document.createElement('span'); authored.dataset.afId = 'kept';
    authored.textContent = 'description'; control.prepend(authored);
    const options = buttons(control); control.remove(); document.body.append(control); buttons(control)[0]!.click();
    expect(control.firstElementChild).toBe(authored); expect(authored.dataset.afId).toBe('kept');
    expect(buttons(control)[1]).toBe(options[1]); registerSegmented();
    expect(document.querySelectorAll('style[data-af-segmented-styles]')).toHaveLength(1);
    let events = 0; control.addEventListener('af-change', () => events++); buttons(control)[2]!.click(); expect(events).toBe(1);
  });
  it('matches the source control shell alignment and caption line-height recipe', () => {
    const control = fixture(); const label = control.querySelector<HTMLElement>('.af-segmented-label')!;
    expect(getComputedStyle(control).verticalAlign).toBe('top');
    expect(getComputedStyle(label).fontSize).toBe('11px');
    expect(getComputedStyle(label).fontWeight).toBe('500');
    expect(getComputedStyle(label).lineHeight).toBe('1.5');
    expect(label.parentElement?.classList.contains('af-segmented-caption')).toBe(true);
    expect(segmentedStyles).toContain('af-segmented .af-segmented-caption{display:flex;align-items:baseline;gap:.75rem;');
    expect(segmentedStyles).toContain('font-size:.875rem;line-height:1.25rem;transition:background-color');
    expect(segmentedStyles).toContain('background:color-mix(in oklab,var(--muted,#eee) 40%,transparent)');
    expect(segmentedStyles).not.toContain('color-mix(in srgb,var(--muted,#eee)');
    expect(segmentedStyles).toContain('focus-visible{z-index:1;outline:2px solid transparent;outline-offset:2px;box-shadow:0 0 0 2px color-mix(in oklab');
  });
});
