// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { AfButton, registerButton } from './button';

const preUpgradeHost = document.createElement('div');
preUpgradeHost.innerHTML = '<af-button type="submit" variant="ghost"><span id="kept">Save</span></af-button>';
const preUpgrade = preUpgradeHost.firstElementChild as AfButton;
Object.defineProperty(preUpgrade, 'disabled', { value: true, writable: true, configurable: true });
Object.defineProperty(preUpgrade, 'busy', { value: true, writable: true, configurable: true });
Object.defineProperty(preUpgrade, 'type', { value: 'reset', writable: true, configurable: true });
Object.defineProperty(preUpgrade, 'variant', { value: 'secondary', writable: true, configurable: true });
Object.defineProperty(preUpgrade, 'size', { value: 'lg', writable: true, configurable: true });
Object.defineProperty(preUpgrade, 'label', { value: 'Saving', writable: true, configurable: true });
registerButton();
afterEach(() => document.body.replaceChildren());

function fixture(attrs = '', content = '<span data-af-id="label">Save</span>') {
  const form = document.createElement('form');
  form.innerHTML = `<af-button ${attrs}>${content}</af-button>`;
  document.body.append(form);
  const host = form.firstElementChild as AfButton;
  const button = host.querySelector('button')!;
  return { form, host, button };
}

describe('native af-button', () => {
  it('moves authored content once into a native button and retains identity and native click', () => {
    const { host, button } = fixture();
    const authored = host.querySelector('[data-af-id="label"]');
    let clicks = 0; button.addEventListener('click', () => clicks++);
    expect(button.tagName).toBe('BUTTON'); expect(button.textContent).toBe('Save');
    expect(button.contains(authored)).toBe(true); expect(authored?.getAttribute('data-af-id')).toBe('label');
    host.setAttribute('variant', 'outline'); host.setAttribute('size', 'lg');
    expect(host.querySelector('[data-af-id="label"]')).toBe(authored);
    button.click(); expect(clicks).toBe(1);
  });

  it('defaults to a non-submitting button and applies supported recipe variants and sizes', () => {
    const variants = ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'];
    const sizes = ['default', 'xs', 'sm', 'lg', 'icon', 'icon-xs', 'icon-sm', 'icon-lg'];
    for (const variant of variants) for (const size of sizes) {
      const { host, button } = fixture(`variant="${variant}" size="${size}"`);
      expect(button.type).toBe('button'); expect(button.dataset.variant).toBe(variant); expect(button.dataset.size).toBe(size);
      host.remove();
    }
    expect(getComputedStyle(fixture().button).display).toBe('inline-flex');
  });

  it('keeps the host measurable and preserves authored classes and layout styles', () => {
    const { host, button } = fixture('class="author-layout" style="margin: 4px"');
    expect(getComputedStyle(host).display).toBe('inline-flex');
    expect(host.classList.contains('author-layout')).toBe(true);
    expect(host.style.margin).toBe('4px');
    expect(button.parentElement).toBe(host);
  });

  it('uses the design-system radius and the recipe spacing when SVG icons are direct children', () => {
    const style = document.querySelector<HTMLStyleElement>('style[data-af-button-styles]')!;
    // The old kit uses rounded-md, whose generated --radius-md comes from --radius - 2px.
    // Almanac sets --radius to 4px, so preserving the token chain yields its intended 2px radius.
    expect(style.textContent).toContain('border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px))');
    expect(style.textContent).toContain('data-size=default]:has(>svg){padding-inline:.75rem');
    expect(style.textContent).toContain('data-size=sm]:has(>svg){padding-inline:.625rem');
    expect(style.textContent).toContain('data-size=lg]:has(>svg){padding-inline:1rem');
  });

  it('matches outline border and dark surface recipe tokens', () => {
    const style = document.querySelector<HTMLStyleElement>('style[data-af-button-styles]')!;
    expect(style.textContent).toContain('data-variant=outline]{color:var(--foreground,#171717);background:var(--background,#fff);border-color:var(--border,#d4d4d4)');
    expect(style.textContent).toContain('html[data-af-dark="true"] af-button>button[data-variant=outline]');
    expect(style.textContent).toContain('color-mix(in srgb,var(--input,#d4d4d4) 30%,transparent)');
  });

  it('reflects disabled, busy and accessible label attributes and blocks programmatic activation', () => {
    for (const attrs of ['disabled', 'busy']) {
      const { host, button } = fixture(attrs);
      let clicks = 0; button.addEventListener('click', () => clicks++);
      expect(button.disabled).toBe(true); button.click(); expect(clicks).toBe(0);
      host.remove();
    }
    const { host, button } = fixture('label="Saving" aria-label="Override"');
    expect(button.getAttribute('aria-label')).toBe('Override');
    host.removeAttribute('aria-label'); expect(button.getAttribute('aria-label')).toBe('Saving');
    host.setAttribute('busy', ''); expect(button.getAttribute('aria-busy')).toBe('true');
    host.removeAttribute('busy'); expect(button.hasAttribute('aria-busy')).toBe(false);
  });

  it('preserves explicit submit/reset semantics and disabled form behavior', () => {
    const { form, host, button } = fixture('type="submit" name="action" value="save"');
    expect(button.type).toBe('submit'); expect(button.name).toBe('action');
    host.setAttribute('disabled', ''); expect(button.disabled).toBe(true);
    host.removeAttribute('disabled'); host.setAttribute('type', 'reset'); expect(button.type).toBe('reset');
    let submits = 0; form.addEventListener('submit', event => { event.preventDefault(); submits++; });
    host.setAttribute('type', 'submit'); button.click(); expect(submits).toBe(1);
  });

  it('forwards focus and reconnects without duplicating handlers or replacing native content', () => {
    const { host, button } = fixture();
    const content = button.firstChild; let clicks = 0;
    button.addEventListener('click', () => clicks++); host.focus();
    expect(document.activeElement).toBe(button);
    host.remove(); document.body.append(host); host.focus(); button.click();
    expect(document.activeElement).toBe(button); expect(button.firstChild).toBe(content); expect(clicks).toBe(1);
  });

  it('supports native keyboard activation, child controls, and pre-upgrade properties', () => {
    const { host, button } = fixture('', '<input aria-label="Nested"><span>Go</span>');
    let clicks = 0; button.addEventListener('click', () => clicks++);
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(clicks).toBe(0); // jsdom does not synthesize browser keyboard activation.
    const input = button.querySelector('input')!;
    input.dispatchEvent(new MouseEvent('click', { bubbles: true })); expect(clicks).toBe(1);
    host.remove(); document.body.append(preUpgradeHost);
    expect(preUpgrade.disabled).toBe(true); expect(preUpgrade.busy).toBe(true);
    expect(preUpgrade.type).toBe('reset'); expect(preUpgrade.variant).toBe('secondary');
    expect(preUpgrade.size).toBe('lg'); expect(preUpgrade.label).toBe('Saving');
    expect(preUpgrade.querySelector('button')?.type).toBe('reset');
    expect(preUpgrade.querySelector('button')?.disabled).toBe(true);
    expect(preUpgrade.querySelector('button')?.dataset.variant).toBe('secondary');
    expect(preUpgrade.querySelector('button')?.dataset.size).toBe('lg');
    expect(preUpgrade.querySelector('button')?.getAttribute('aria-label')).toBe('Saving');
    expect(preUpgrade.querySelector('#kept')?.textContent).toBe('Save');
  });

  it('registers its tag and stylesheet idempotently', () => {
    registerButton(); registerButton();
    expect(customElements.get('af-button')).toBe(AfButton);
    expect(document.querySelectorAll('style[data-af-button-styles]')).toHaveLength(1);
  });
});
