// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { AfSlider, registerSlider } from './slider';

registerSlider();
afterEach(() => document.body.replaceChildren());
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
function fixture(attrs = '', content = '') {
  const host = document.createElement('div');
  host.innerHTML = `<af-slider ${attrs}>${content}</af-slider>`;
  document.body.append(host);
  const root = host.firstElementChild as AfSlider;
  return {root, input: root.querySelector<HTMLInputElement>('input[type=range]')!, readout: root.querySelector<HTMLElement>('[part=readout]')!, label: root.querySelector<HTMLLabelElement>('label')!};
}
describe('af-slider', () => {
  it('uses native range defaults and keeps authored children and IDs', () => {
    const {root,input} = fixture('', '<span data-af-id="authored">Keep me</span>');
    expect(root.value).toBeNull(); expect(input.min).toBe('0'); expect(input.max).toBe('100'); expect(input.step).toBe('1');
    expect(input.value).toBe('0'); expect(root.querySelector('[data-af-id=authored]')?.textContent).toBe('Keep me');
    expect(input.labels?.[0]).toBe(root.querySelector('label'));
  });
  it('keeps the label and value readout on a shared header above the range track', () => {
    const {root,input,label,readout} = fixture('label="Level" default-value="40" suffix="%"');
    const header = root.querySelector<HTMLElement>('[part="header"]');
    expect(header).not.toBeNull();
    expect(label.parentElement).toBe(header);
    expect(readout.parentElement).toBe(header);
    expect(header!.nextElementSibling).toBe(input);
    expect(getComputedStyle(header!).display).toBe('flex');
    expect(getComputedStyle(header!).justifyContent).toBe('space-between');
    expect(header!.textContent).toContain('Level');
    expect(header!.textContent).toContain('40%');
    expect(getComputedStyle(root).minWidth).toBe('176px');
    expect(getComputedStyle(input).height).toBe('6px');
    expect(getComputedStyle(input).margin).toBe('0px');
  });
  it('uses default-value for uncontrolled state and emits accepted native changes', () => {
    const {root,input,readout} = fixture('default-value="25" label="Volume" min="10" max="40" step="5" prefix="$" suffix=" USD" format=".1f"');
    expect(root.value).toBe(25); expect(input.value).toBe('25'); expect(readout.textContent).toBe('$25.0 USD');
    let detail: unknown; root.addEventListener('af-change', e => { detail = (e as CustomEvent).detail; });
    input.value = '35'; input.dispatchEvent(new Event('input', {bubbles:true}));
    expect(detail).toEqual({value:35}); expect(root.value).toBe(35); expect(readout.textContent).toBe('$35.0 USD');
  });
  it('supports controlled property and attribute values and waits for author reflection', () => {
    const {root,input,readout} = fixture('value="30" min="10" max="40"');
    input.value = '35'; input.dispatchEvent(new Event('input', {bubbles:true}));
    expect(root.value).toBe(30); expect(readout.textContent).toBe('30');
    root.setAttribute('value','35'); expect(root.value).toBe(35); expect(input.value).toBe('35');
    root.value = null; expect(root.value).toBeNull(); expect(input.value).toBe('10'); expect(readout.textContent).toBe('—');
  });
  it('handles bounds, empty and invalid values, and emits cancelable composed intent', () => {
    const {root,input,readout} = fixture('value="bad" min="-2" max="8"');
    expect(root.value).toBeNull(); expect(input.value).toBe('-2'); expect(readout.textContent).toBe('—');
    let event: CustomEvent | undefined; root.addEventListener('af-change', e => { event = e as CustomEvent; e.preventDefault(); });
    input.value = '8'; input.dispatchEvent(new Event('input', {bubbles:true}));
    expect(event?.detail).toEqual({value:8}); expect(event?.bubbles).toBe(true); expect(event?.composed).toBe(true); expect(event?.cancelable).toBe(true);
    expect(root.value).toBeNull(); expect(input.value).toBe('-2');
  });
  it('does not emit for same-value property or attribute reflection and honors disabled and readonly', () => {
    const {root,input} = fixture('value="5" disabled readonly'); let changes = 0;
    root.addEventListener('af-change', () => changes++); root.value = 5; root.setAttribute('value','5');
    expect(input.disabled).toBe(true); expect(input.readOnly).toBe(true); expect(getComputedStyle(input).opacity).toBe('0.5'); expect(changes).toBe(0);
  });
  it('formats numbers and falls back to raw values for invalid format strings', () => {
    const {readout,root} = fixture('default-value="1234" format=",.0f" prefix="≈"');
    expect(readout.textContent).toBe('≈1,234'); root.setAttribute('format','not a format');
    expect(readout.textContent).toBe('≈1234');
  });
  it('repairs a pre-upgrade value, reconnects once, and isolates multiple sliders', async () => {
    const host = document.createElement('div'); host.innerHTML = '<af-slider><input id="keep" type="range"></af-slider><af-slider default-value="2"></af-slider>';
    const [first,second] = [...host.querySelectorAll<AfSlider>('af-slider')]; Object.defineProperty(first!, 'value', {value:7,writable:true,configurable:true}); document.body.append(host);
    expect(first!.value).toBe(7); expect(first!.querySelector('#keep')).not.toBeNull();
    first!.remove(); host.append(first!); await tick(); let changes = 0; first!.addEventListener('af-change', () => changes++);
    const input = first!.querySelector('input')!; input.value='8'; input.dispatchEvent(new Event('input',{bubbles:true}));
    expect(changes).toBe(1); expect(second!.value).toBe(2);
  });
});
