// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import './markdown-editor';

type Field = HTMLElement & { value: string | null };
afterEach(() => document.body.replaceChildren());
function mount(source: string, controlled = true) {
  const editor = document.createElement('af-markdown-editor') as Field;
  editor.setAttribute(controlled ? 'value' : 'default-value', source);
  editor.setAttribute('label', 'Notes');
  document.body.append(editor);
  const mode = (name: string) => editor.querySelector<HTMLButtonElement>(`[data-mode="${name}"]`)!.click();
  const field = () => editor.querySelector('textarea')!;
  const input = (s: string) => { field().value = s; field().dispatchEvent(new Event('input', { bubbles: true })); };
  return { editor, field, mode, input };
}
it('exposes exact source, preserves drafts across mode changes and renders them in Visual', () => {
  const initial = '* item\n\n_Unchanged_  \n';
  const draft = '| Metric | Meaning |\n| --- | --- |\n| Net | A \\| B |\n\n_italic_\n';
  const { editor, mode, field, input } = mount(initial);
  const changes: string[] = [];
  editor.addEventListener('af-change', e => { editor.value = (e as CustomEvent).detail.value; changes.push(editor.value!); });
  mode('markdown'); expect(field().value).toBe(initial);
  input(draft); mode('visual');
  expect(editor.querySelector('td')?.textContent).toBe('Net');
  expect(editor.querySelector('em')?.textContent).toBe('italic');
  mode('markdown'); expect(field().value).toBe(draft);
  expect(changes).toEqual([draft]);
  editor.value = 'replacement'; expect(field().value).toBe('replacement');
});
it('keeps source mode under the existing field contract', () => {
  const { editor, mode, field, input } = mount('* Original', false);
  mode('markdown'); input('**updated**'); expect(editor.value).toBe('**updated**');
  const veto = (e: Event) => e.preventDefault();
  editor.addEventListener('af-change', veto); input('rejected'); expect(field().value).toBe('**updated**');
  editor.removeEventListener('af-change', veto); input(''); expect(editor.value).toBeNull();
  editor.setAttribute('readonly', ''); expect(field().readOnly).toBe(true);
  editor.setAttribute('disabled', ''); expect(field().disabled).toBe(true);
});
it('restores a controlled source edit the caller does not accept', () => {
  const { mode, field, input } = mount('original');
  mode('markdown'); input('rejected'); expect(field().value).toBe('original');
});
