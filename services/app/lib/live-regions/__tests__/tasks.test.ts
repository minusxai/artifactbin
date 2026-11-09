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

it.todo('undo a toggle after concurrent line-format normalization restores its prior value');
