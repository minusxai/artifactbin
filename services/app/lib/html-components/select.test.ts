// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { AfSelect } from './select';
import './select';
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
  const search=root.querySelector<HTMLInputElement>('[role=searchbox]');
  expect(search?.getAttribute('aria-label')).toBe('Search Pick');
  expect(search?.parentElement?.classList.contains('af-select-search')).toBe(true);
  expect(root.querySelector('[role=listbox]')?.parentElement?.classList.contains('af-select-popup')).toBe(true);
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
it('shows the native-style disclosure cue without bolding the selected option', () => {
  const root = fixture(); const button = trigger(root);
  const icon = button.querySelector<SVGSVGElement>('[part="chevron"]');
  expect(icon?.getAttribute('aria-hidden')).toBe('true');
  expect(icon?.querySelector('path')?.getAttribute('d')).toBe('m6 9 6 6 6-6');
  button.click();
  const selected = option(root, 'Alpha'); const idle = option(root, 'Beta');
  expect(getComputedStyle(selected).fontWeight).toBe(getComputedStyle(idle).fontWeight);
});
it('shows a visible selected-option checkmark and moves it with selection', () => {
  const root = document.createElement('af-select') as AfSelect;
  root.options = ['Alpha', 'Beta']; root.defaultValue = 'Alpha'; document.body.append(root);
  trigger(root).click();
  const marker = (text: string) => option(root, text).querySelector<SVGSVGElement>('[data-selected-indicator]');
  expect(marker('Alpha')).not.toBeNull();
  expect(marker('Alpha')?.getAttribute('aria-hidden')).toBe('true');
  expect(marker('Alpha')?.querySelector('path')?.getAttribute('d')).toBe('M20 6 9 17l-5-5');
  expect(marker('Beta')).toBeNull();
  option(root, 'Beta').click(); trigger(root).click();
  expect(marker('Alpha')).toBeNull();
  expect(marker('Beta')).not.toBeNull();
});
it('aligns the Select control and gives the focused search a translucent ring', () => {
  const root = fixture();
  expect(getComputedStyle(root).verticalAlign).toBe('top');
  const label = root.querySelector<HTMLElement>('.af-select-label')!;
  expect(getComputedStyle(label).display).toBe('flex');
  expect(getComputedStyle(label).alignItems).toBe('baseline');
  const styles = document.querySelector<HTMLStyleElement>('[data-af-select-styles]')!.textContent!;
  expect(styles).toContain('font:inherit;line-height:1.5');
  expect(styles).toContain('@media(hover:hover){af-select .af-select-trigger:hover{background-color:color-mix(in srgb,var(--muted,light-dark(#eee,#444)) 40%,transparent);background-color:color-mix(in oklab,var(--muted,light-dark(#eee,#444)) 40%,transparent)}}');
  trigger(root).click();
  const search = root.querySelector<HTMLInputElement>('[role=searchbox]')!;
  expect(document.activeElement).toBe(search);
  expect(styles).toContain('af-select button:focus-visible,af-select input:focus-visible{outline:none;outline-offset:0;box-shadow:0 0 0 2px color-mix(in oklab,var(--ring,light-dark(#777,#aaa)) 50%,transparent)}');
  expect(styles).toContain('af-select .af-select-trigger:focus-visible{box-shadow:0 0 0 2px color-mix(in oklab,var(--ring,light-dark(#777,#aaa)) 50%,transparent),0 1px 2px #0000000d}');
});
it('normalizes malformed options and keeps typed duplicate values separate', () => {
  const root = fixture(); root.setAttribute('options', 'null'); root.options = null as never;
  trigger(root).click(); expect(root.querySelectorAll('[role=option]')).toHaveLength(0);
  root.options = [2, '2', 2, { value: false, label: '2' }];
  expect(root.querySelectorAll('[role=option]')).toHaveLength(3);
});
it('retains option identity across filtering and reordering', () => {
  const root = fixture(); trigger(root).click(); const id = option(root, 'Beta').id;
  const input = root.querySelector('input')!; input.value = 'Beta'; input.dispatchEvent(new Event('input'));
  expect(option(root, 'Beta').id).toBe(id);
  root.options = ['Beta', 'Alpha']; expect(option(root, 'Beta').id).toBe(id);
});
it('does not overwrite external controlled changes or report unchanged multiple drafts', () => {
  const root = fixture(true); root.value = []; let changes = 0; root.addEventListener('af-change', () => changes++);
  trigger(root).click(); root.querySelector<HTMLButtonElement>('[data-done]')!.click(); expect(changes).toBe(0);
  trigger(root).click(); option(root, 'Alpha').click(); root.value = ['Beta'];
  root.querySelector<HTMLButtonElement>('[data-done]')!.click(); expect(changes).toBe(0); expect(root.value).toEqual(['Beta']);
});
it('isolates nested picker keyboard handling and keeps number distinct from created strings', () => {
  const outer = fixture(); const inner = fixture(true); outer.append(inner); inner.options = [2]; inner.allowCreate = true;
  trigger(inner).dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
  expect(trigger(outer).getAttribute('aria-expanded')).toBe('false');
  option(inner, 'Create “2”').click(); inner.querySelector<HTMLButtonElement>('[data-done]')!.click(); expect(inner.value).toEqual(['2']);
});
it('cancels multi drafts, disables open interactions, and cleans outside listeners across reconnect', () => {
  const root = fixture(true); let changes = 0; root.addEventListener('af-change', event => { changes++; event.preventDefault(); });
  trigger(root).click(); option(root, 'Alpha').click(); root.querySelector<HTMLButtonElement>('[data-done]')!.click(); expect(root.value).toEqual([]);
  trigger(root).click(); option(root, 'Beta').click(); root.disabled = true; expect(root.value).toEqual([]); expect(trigger(root).disabled).toBe(true);
  root.disabled = false; root.remove(); document.body.append(root); trigger(root).click(); option(root, 'Alpha').click();
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); expect(changes).toBe(2); expect(root.value).toEqual([]);
});
it('keeps popup within viewport and flips above near the bottom', () => {
  const root = fixture();
  trigger(root).getBoundingClientRect = () => ({ left: 1000, right: 1100, top: 740, bottom: 770, width: 100, height: 30, x: 1000, y: 740, toJSON() {} });
  const popup = root.querySelector<HTMLElement>('[data-popup]')!;
  popup.getBoundingClientRect = () => ({ left: 0, right: 200, top: 0, bottom: 200, width: 200, height: 200, x: 0, y: 0, toJSON() {} });
  trigger(root).click();
  expect(popup.style.position).toBe('fixed'); expect(Number.parseFloat(popup.style.left) + Number.parseFloat(popup.style.width)).toBeLessThanOrEqual(innerWidth - 8);
  expect(Number.parseFloat(popup.style.top)).toBeLessThan(740);
});

it('distinguishes an empty placeholder from selected zero and false labels',()=>{const root=fixture();root.setAttribute('placeholder','All categories');const value=()=>root.querySelector('.af-select-value')!;expect(value().textContent).toBe('All categories');expect(value().hasAttribute('data-placeholder')).toBe(true);root.options=[{value:0,label:'Zero'},{value:false,label:'False'}];root.value=0;expect(value().textContent).toBe('Zero');expect(value().hasAttribute('data-placeholder')).toBe(false);root.value=false;expect(value().textContent).toBe('False');expect(value().hasAttribute('data-placeholder')).toBe(false);root.value=null;expect(value().textContent).toBe('All categories');expect(value().hasAttribute('data-placeholder')).toBe(true);});
