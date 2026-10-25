// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { AfSwitch, registerSwitch, type AfSwitchChangeDetail } from './switch';

registerSwitch();
afterEach(() => document.body.replaceChildren());

function fixture(attrs = '', content = '') {
  const host = document.createElement('div');
  host.innerHTML = `<af-switch ${attrs}>${content}</af-switch>`;
  document.body.append(host);
  const root = host.firstElementChild as AfSwitch;
  const button = root.querySelector('button')!;
  return { root, button };
}

describe('af-switch', () => {
  it('uses the source story label line-height while inheriting the page font', () => {
    const style = document.querySelector('style[data-af-switch-styles]')?.textContent ?? '';
    expect(style).toContain('af-switch .af-switch-label{font-size:11px;font-weight:500;letter-spacing:.05em;text-transform:uppercase;line-height:1.5;');
  });

  it('renders a labeled native switch and initializes from checked presence or default-checked', () => {
    const { root, button } = fixture('label="Notifications" checked');
    expect(button.tagName).toBe('BUTTON');
    expect(button.type).toBe('button');
    expect(button.getAttribute('role')).toBe('switch');
    expect(button.getAttribute('aria-label')).toBe('Notifications');
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(root.checked).toBe(true);
    expect(fixture('default-checked').root.checked).toBe(true);
  });

  it('emits cancelable composed bubbling intent and keeps uncontrolled state after activation', () => {
    const { root, button } = fixture('aria-label="Wi-Fi"');
    let event: CustomEvent<AfSwitchChangeDetail> | undefined;
    root.addEventListener('af-change', e => { event = e as CustomEvent<AfSwitchChangeDetail>; });
    button.click();
    expect(root.checked).toBe(true);
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(event?.detail).toEqual({ value: true });
    expect(event?.bubbles).toBe(true);
    expect(event?.composed).toBe(true);
    expect(event?.cancelable).toBe(true);
  });

  it('waits for controlled property and attribute reflection and ignores canceled changes', () => {
    const { root, button } = fixture('checked');
    button.click();
    expect(root.checked).toBe(true);
    root.checked = false;
    expect(button.getAttribute('aria-checked')).toBe('false');
    root.addEventListener('af-change', e => e.preventDefault());
    root.removeAttribute('checked');
    button.click();
    expect(root.checked).toBe(false);
  });

  it('reflects disabled and read-only state without dispatching intent', () => {
    const { root, button } = fixture('disabled');
    let changes = 0;
    root.addEventListener('af-change', () => changes++);
    button.click();
    expect(root.checked).toBe(false);
    expect(changes).toBe(0);
    root.removeAttribute('disabled');
    root.setAttribute('read-only', '');
    button.click();
    expect(root.checked).toBe(false);
    expect(changes).toBe(0);
  });

  it('preserves authored content and IDs through updates and reconnects without duplicate listeners', () => {
    const { root, button } = fixture('label="Sound"', '<span id="authored" data-af-id="stable">Sound</span>');
    const child = root.querySelector('#authored')!;
    root.checked = true;
    root.remove(); document.body.append(root);
    expect(root.querySelector('#authored')).toBe(child);
    let changes = 0;
    root.addEventListener('af-change', () => changes++);
    button.click();
    expect(changes).toBe(1);
  });

  it('supports a pre-upgrade checked property and scoped idempotent registration', () => {
    const host = document.createElement('div');
    host.innerHTML = '<af-switch aria-label="Pre-upgrade"></af-switch>';
    const root = host.firstElementChild as HTMLElement & { checked: boolean };
    Object.defineProperty(root, 'checked', { value: true, writable: true, configurable: true });
    const definitions = new Map<string, CustomElementConstructor>();
    const registry = {
      get: (name: string) => definitions.get(name),
      define: (name: string, ctor: CustomElementConstructor) => { definitions.set(name, ctor); },
    } as unknown as CustomElementRegistry;
    const isolatedDocument = document.implementation.createHTMLDocument('isolated');
    registerSwitch(registry, isolatedDocument);
    registerSwitch(registry, isolatedDocument);
    expect(isolatedDocument.querySelectorAll('style[data-af-switch-styles]')).toHaveLength(1);
    document.body.append(host);
    registerSwitch();
    expect((host.firstElementChild as AfSwitch).checked).toBe(true);
  });
  it('uses the same two pixel focus ring recipe as the source switch', () => {
    const styles = document.querySelector<HTMLStyleElement>('style[data-af-switch-styles]')!.textContent!;
    expect(styles).toContain('focus-visible{outline:2px solid transparent;outline-offset:2px;box-shadow:0 0 0 2px color-mix(in oklab');
    expect(styles).toContain(',0 1px 2px #0000000d');
  });
});
