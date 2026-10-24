// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { AfSelect, registerSelect } from './select';
registerSelect();
afterEach(() => document.body.replaceChildren());
function fixture(multiple = false) {
  const root = document.createElement('af-select') as AfSelect;
  root.options = ['Alpha', { value: 2, label: 'Two' }, 'Beta'];
  root.multiple = multiple;
  root.setAttribute('label', 'Pick');
  document.body.append(root);
  return root;
}
const trigger = (root: AfSelect) => root.querySelector('button')!;
const option = (root: AfSelect, text: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('[role=option]')).find(el => el.textContent === text)!;
it('selects typed options, emits cancelable intent, and respects controlled values', () => {
  const root = fixture(); const events: CustomEvent[] = [];
  root.addEventListener('af-change', e => events.push(e as CustomEvent));
  trigger(root).click(); option(root, 'Two').click();
  expect(root.value).toBe(2); expect(events[0]?.detail).toEqual({ value: 2 });
  expect(events[0]?.cancelable && events[0]?.bubbles && events[0]?.composed).toBe(true);
  root.value = 'Alpha'; trigger(root).click(); option(root, 'Beta').click();
  expect(root.value).toBe('Alpha');
});
it('filters, supports nullable choice and keyboard search', () => {
  const root = fixture(); root.setAttribute('placeholder', 'All');
  trigger(root).dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }));
  expect(root.querySelector('[role=searchbox]')?.getAttribute('aria-label')).toBe('Search Pick');
  root.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(root.value).toBe(2);
  trigger(root).click(); option(root, 'All').click(); expect(root.value).toBe(null);
});
it('keeps multiple drafts until Done or outside and cancels Escape', () => {
  const root = fixture(true); trigger(root).click(); option(root, 'Alpha').click();
  expect(root.value).toEqual([]);
  root.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  trigger(root).click(); option(root, 'Beta').click();
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(root.value).toEqual(['Beta']);
  trigger(root).click(); option(root, 'Alpha').click(); root.querySelector<HTMLButtonElement>('[data-done]')!.click();
  expect(root.value).toEqual(['Beta', 'Alpha']);
});
it('creates trimmed unique entries, reports no matches, and preserves authored nodes on reconnect', () => {
  const root = fixture(true); root.allowCreate = true;
  const authored = document.createElement('span'); authored.dataset.afId = 'stable'; root.append(authored);
  trigger(root).click(); const input = root.querySelector('input')!;
  input.value = ' New '; input.dispatchEvent(new Event('input'));
  option(root, 'Create “New”').click(); root.querySelector<HTMLButtonElement>('[data-done]')!.click();
  expect(root.value).toEqual(['New']);
  root.remove(); document.body.append(root); expect(root.contains(authored)).toBe(true);
  trigger(root).click(); input.value = 'New'; input.dispatchEvent(new Event('input'));
  expect(root.querySelector('[data-create]')).toBe(null);
  root.allowCreate = false; input.value = 'zzz'; input.dispatchEvent(new Event('input'));
  expect(root.querySelector('[role=status]')?.textContent).toBe('No matches');
});
it('cancels changes and closes when disabled', () => {
  const root = fixture(); root.addEventListener('af-change', e => e.preventDefault());
  trigger(root).click(); option(root, 'Alpha').click(); expect(root.value).toBe(null);
  trigger(root).click(); root.disabled = true;
  expect(root.querySelector('[role=listbox]')?.closest<HTMLElement>('[data-popup]')?.hidden).toBe(true);
});
it('connects keyboard highlight to the searchbox active descendant', () => {
  const root = fixture(); trigger(root).click(); const input = root.querySelector('input')!;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  const id = input.getAttribute('aria-activedescendant');
  expect(id).toBeTruthy(); expect(document.getElementById(id!)?.textContent).toBe('Alpha');
});
