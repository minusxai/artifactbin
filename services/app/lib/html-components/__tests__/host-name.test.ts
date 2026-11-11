// @vitest-environment jsdom
/**
 * ONE ELEMENT CARRIES A CONTROL'S NAME (../host-name). An author's `aria-label` on a form control's host names the
 * native control alone: the host never keeps the attribute, so assistive tech reads the name once and a strict label
 * locator matches one element. Setting it renames, an empty value, `removeAttribute` or `ariaLabel = null` clears it,
 * and moving the element keeps it. `af-segmented` is the exception by design: its host IS the named group.
 */
import { afterEach, describe, expect, it } from 'vitest';
import '../input';
import '../textarea';
import '../switch';
import '../select';
import '../slider';
import '../date-picker';
import '../button';
import '../segmented';

afterEach(() => document.body.replaceChildren());
type Host = HTMLElement & { ariaLabel: string | null };
const mount = (markup: string): Host => {
  const box = document.createElement('div'); box.innerHTML = markup; document.body.append(box);
  return box.firstElementChild as Host;
};
/** Every visible element in the control that exposes `name`: by aria-label, or by a label naming it. */
const carriers = (root: Element, name: string): Element[] => [root, ...root.querySelectorAll('*')].filter((el) =>
  !el.closest('[hidden]') && (el.getAttribute('aria-label') === name ||
    [...((el as HTMLInputElement).labels ?? [])].some((label) => label.textContent === name)));
const nativeCarrier = (root: Element, name: string): Element => {
  const found = carriers(root, name);
  expect(found, name).toHaveLength(1);
  expect(found[0]).not.toBe(root);
  expect(['INPUT', 'TEXTAREA', 'BUTTON']).toContain(found[0]!.tagName);
  return found[0]!;
};

describe.each(['af-input', 'af-textarea', 'af-switch', 'af-select', 'af-slider', 'af-date-picker', 'af-button'])('%s', (tag) => {
  it('gives the author\'s aria-label to its native control alone, and follows every change to it', () => {
    const root = mount(`<${tag} aria-label="Alpha"></${tag}>`);
    const control = nativeCarrier(root, 'Alpha');
    expect(root.hasAttribute('aria-label')).toBe(false);
    expect(root.ariaLabel).toBe('Alpha');
    root.setAttribute('aria-label', 'Beta');
    expect(nativeCarrier(root, 'Beta')).toBe(control);
    expect([root.hasAttribute('aria-label'), carriers(root, 'Alpha')]).toEqual([false, []]);
    root.removeAttribute('aria-label');
    expect([carriers(root, 'Beta'), root.ariaLabel]).toEqual([[], null]);
    root.ariaLabel = 'Gamma';
    expect(nativeCarrier(root, 'Gamma')).toBe(control);
    root.parentElement!.append(root);
    nativeCarrier(root, 'Gamma');
    root.setAttribute('aria-label', '');
    expect([carriers(root, 'Gamma'), root.ariaLabel, root.hasAttribute('aria-label')]).toEqual([[], null, false]);
  });
  it('keeps a visible label working beside it', () => {
    const root = mount(`<${tag} label="Shown" aria-label="Spoken"></${tag}>`);
    nativeCarrier(root, 'Spoken');
    expect(root.textContent).toContain(tag === 'af-button' ? '' : 'Shown');
  });
});

describe('af-segmented', () => {
  it('is the named group itself: its host carries the name, once', () => {
    const root = mount('<af-segmented aria-label="Range"></af-segmented>');
    expect(root.getAttribute('role')).toBe('group');
    expect(carriers(root, 'Range')).toEqual([root]);
  });
});
