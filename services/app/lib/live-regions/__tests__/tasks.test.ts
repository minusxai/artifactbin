// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { Room, type Client } from './harness';
import { regionMarkdown } from '../markdown';
let room: Room;
afterEach(() => room?.destroy());
const open = (html = '<p></p>') => {
  const result = Room.open('rich', html);
  room = result[0];
  return result as [Room, Client, Client];
};
it.each(['- [ ] ', '- [x] ', '[ ] '])('types task shortcut %s', (prefix) => {
  const [, a] = open();
  a.select(1).type(prefix + 'work');
  expect(a.state.doc.firstChild!.attrs.checked).toBe(prefix.includes('x'));
  expect(a.state.doc.textContent).toBe('work');
  room.invariants();
});
it('roundtrips Markdown, HTML and saved state', () => {
  const [, a] = open();
  room.agent('- [x] done\n- [ ] next').sync();
  expect(a.state.doc.firstChild!.attrs.checked).toBe(true);
  expect(regionMarkdown('rich', room.html())).toContain('[x] done');
  room.compact();
  expect(room.join('reload').state.doc.firstChild!.attrs.checked).toBe(true);
  room.invariants();
});
it('toggles accessibly, undoes and converges with concurrent typing without moving ids', () => {
  const [, a, b] = open('<ul><li role="checkbox" aria-checked="false" aria-disabled="true"><p>work</p></li></ul>');
  const ids = a.state.doc.firstChild!.attrs;
  const control = a.view.dom.querySelector('[role="checkbox"]') as HTMLElement;
  expect(control).not.toBeNull();
  control.click();
  a.undo(); expect(a.state.doc.firstChild!.attrs.checked).toBe(false);
  a.redo(); expect(a.state.doc.firstChild!.attrs.checked).toBe(true);
  b.select(b.blockStart(0, true)).type(' now');
  room.sync();
  expect(a.state.doc.firstChild!.attrs).toMatchObject({ checked: true, afId: ids.afId, itemId: ids.itemId });
  expect(a.state.doc.textContent).toBe('work now');
  room.invariants();
  expect(a.state.doc.firstChild!.attrs.checked).toBe(true);
});

it('pastes tasks and retains their state through indent, outdent and enter', () => {
  const [, a] = open();
  a.select(1).pasteText('- [x] first\n- [ ] second');
  expect(a.state.doc.child(0).attrs.checked).toBe(true);
  a.select(a.blockStart(1)).key('Tab');
  expect(a.state.doc.child(1).attrs).toMatchObject({ checked: false, depth: 2 });
  a.key('Tab', { shift: true });
  a.select(a.blockStart(0, true)).key('Enter');
  expect(a.state.doc.child(1).attrs.checked).toBe(false);
  a.key('Enter');
  expect(a.state.doc.child(1).attrs).toMatchObject({ checked: null, list: null });
  room.invariants();
});
it('refuses interactive toggling in a readonly editor', () => {
  const [, a] = open('<ul><li role="checkbox" aria-checked="false"><p>work</p></li></ul>');
  a.view.setProps({ editable: () => false });
  const control = a.view.dom.querySelector('input')!;
  control.click();
  expect(a.state.doc.firstChild!.attrs.checked).toBe(false);
});

it('undo a toggle after concurrent line-format normalization restores its prior value', () => {
  const [, a, b] = open('<ul><li role="checkbox" aria-checked="false"><p>work</p></li></ul>');
  const ids = a.state.doc.firstChild!.attrs;
  (a.view.dom.querySelector('input') as HTMLInputElement).click();
  b.select(b.blockStart(0, true)).type(' now');
  room.sync().invariants();
  a.undo(); room.sync();
  expect(a.state.doc.firstChild!.attrs).toMatchObject({ checked: false, afId: ids.afId, itemId: ids.itemId });
  expect(a.state.doc.textContent).toBe('work now');
  room.invariants();
  a.redo(); room.sync();
  expect(a.state.doc.firstChild!.attrs.checked).toBe(true);
  room.invariants();
});
it.each(['- [ ]', '- [x]'])('roundtrips empty task %s', (markdown) => {
  const [, a] = open();
  room.agent(markdown).sync();
  expect(a.state.doc.firstChild!.attrs.checked).toBe(markdown.includes('x'));
  const saved = regionMarkdown('rich', room.html());
  room.agent(saved).sync();
  expect(a.state.doc.firstChild!.attrs.checked).toBe(markdown.includes('x'));
  room.invariants();
});
it.each(['- **[x]** work', '- `[x]` work', '- **[x] work**', '- `[x] work`'])('keeps marked marker literal: %s', (markdown) => {
  const [, a] = open();
  room.agent(markdown).sync();
  expect(a.state.doc.firstChild!.attrs.checked).toBe(null);
  expect(a.state.doc.textContent).toBe('[x] work');
});
it('updates checkbox disabled state when editability changes without document edits', () => {
  const [, a] = open('<ul><li role="checkbox" aria-checked="false"><p>work</p></li></ul>');
  let checked = false;
  for (const editable of [false, true, false]) {
    a.view.setProps({ editable: () => editable });
    const control = a.view.dom.querySelector('input')!;
    expect(control.disabled).toBe(!editable);
    control.click();
    if (editable) checked = !checked;
    expect(a.state.doc.firstChild!.attrs.checked).toBe(checked);
  }
});

it('keeps checkbox history grouped with text and does not resurrect a remotely deleted task', () => {
  const [, a, b] = open('<ul><li role="checkbox" aria-checked="false"><p>work</p></li></ul><p>tail</p>');
  (a.view.dom.querySelector('input') as HTMLInputElement).click();
  a.select(a.blockStart(0, true)).type(' local');
  b.select(b.blockStart(0, true)).type(' remote');
  room.sync();
  a.undo(); room.sync();
  expect(a.state.doc.textContent).toBe('work remotetail');
  expect(a.state.doc.firstChild!.attrs.checked).toBe(false);
  room.invariants();
  a.redo(); room.sync();
  expect(a.state.doc.textContent).toBe('work local remotetail');
  expect(a.state.doc.firstChild!.attrs.checked).toBe(true);
  room.invariants();
  b.delete(0, b.state.doc.firstChild!.nodeSize); room.sync();
  a.undo(); room.sync();
  expect(a.state.doc.textContent).toBe('tail');
  room.invariants();
});
