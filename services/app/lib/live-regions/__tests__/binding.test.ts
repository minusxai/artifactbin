// @vitest-environment jsdom
/**
 * The ProseMirror ↔ Y.Text binding itself (binding.ts): what each local step writes, how a remote change moves the
 * local selection, composition, multi-block paste, undo interleaved with remote edits, no echo, and the relative-
 * position helpers. Every test ends with the room's invariants.
 */
import { TextSelection } from 'prosemirror-state';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { absolutePosition, regionText, relativePosition } from '..';
import { bare, Room, type Client } from './harness';

let rooms: Room[] = [];
afterEach(() => { rooms.forEach((room) => room.destroy()); rooms = []; });
const open = (region: string, names?: string[]) => {
  const [room, ...clients] = Room.open('rich', region, names);
  rooms.push(room);
  return [room, ...clients] as [Room, Client, Client, Client];
};
/** The text and block attributes of a client's shared text, as delta. */
const delta = (client: Client) => regionText(client.doc).toDelta();
/** Every Y.Text change a client's next action writes. */
function writes(client: Client, action: () => void) {
  const recorded: unknown[] = [];
  const text = regionText(client.doc);
  const observe = (event: Y.YTextEvent) => { recorded.push(...event.delta); };
  text.observe(observe);
  action();
  text.unobserve(observe);
  return recorded;
}

describe('local steps become the smallest edits', () => {
  it('typing inserts the typed characters, with the marks at the cursor', () => {
    const [room, A] = open('<p>Hello <strong>bold</strong></p>');
    const ops = writes(A, () => A.select(A.find('bo', { after: true })).type('XY'));
    expect(ops).toEqual([{ retain: 8 }, { insert: 'X', attributes: { bold: true } }, { retain: 9 }, { insert: 'Y', attributes: { bold: true } }]);
    expect(bare(room.invariants())).toBe('<p>Hello <strong>boXYld</strong></p>');
  });

  it('Enter in the middle inserts one "\\n"; at the end the new line goes after the old "\\n", which keeps its block', () => {
    const [room, A] = open('<h2>Title here</h2>');
    const middle = writes(A, () => A.select(A.find('Title', { after: true })).key('Enter'));
    expect(middle.filter((op) => 'insert' in (op as object))).toEqual([{ insert: '\n', attributes: expect.objectContaining({ level: 2 }) }]);
    const end = writes(A, () => A.select(A.blockStart(1, true)).key('Enter'));
    expect(end).toEqual([{ retain: 'Title\n here\n'.length }, { insert: '\n' }]);
    expect(bare(room.invariants())).toBe('<h2>Title</h2><h2>here</h2><p></p>');
  });

  it('Backspace-join deletes the "\\n" and gives the joined line the first block\'s attributes', () => {
    const [room, A] = open('<h2>Title</h2><p>body</p>');
    const ops = writes(A, () => A.select(A.blockStart(1)).key('Backspace'));
    expect(ops[1]).toEqual({ delete: 1 });
    expect(bare(room.invariants())).toBe('<h2>Titlebody</h2>');
  });

  it('a block type change is a format of its "\\n" only', () => {
    const [room, A] = open('<p>Hello</p>');
    const ops = writes(A, () => A.select(A.blockStart(0)).type('## '));
    expect(ops.filter((op) => 'insert' in (op as object) || 'delete' in (op as object))).toEqual([{ insert: '#' }, { insert: '#' }, { delete: 2 }]);
    expect(delta(A).at(-1)).toEqual({ insert: '\n', attributes: expect.objectContaining({ level: 2 }) });
    expect(bare(room.invariants())).toBe('<h2>Hello</h2>');
  });
});

describe('remote changes and the local selection', () => {
  it('a remote edit inside the locally selected range keeps the selection on the same characters', () => {
    const [room, A, B] = open('<p>one two three four</p>');
    A.select(A.find('two'), A.find('three', { after: true }));
    B.select(B.find('two ', { after: true })).type('and a half ').select(B.blockStart(0)).type('zero ');
    room.sync();
    expect(A.state.doc.textBetween(A.state.selection.from, A.state.selection.to)).toBe('two and a half three');
    A.type('X');
    expect(bare(room.invariants())).toBe('<p>zero one X four</p>');
  });

  it('a remote deletion around the cursor leaves it where the deleted text was', () => {
    const [room, A, B] = open('<p>Hello wonderful world</p>');
    A.select(A.find('wonder', { after: true }));
    B.delete(B.find('wonderful '), B.find('wonderful ', { after: true }));
    room.sync();
    A.type('X');
    expect(bare(room.invariants())).toBe('<p>Hello Xworld</p>');
  });

  it('remote updates are never echoed back', () => {
    const [room, A, B] = open('<p>x</p>');
    A.select(A.blockStart(0, true)).type(' from A').key('Enter').type('# heading');
    room.send(A);
    room.receive(B);
    expect(B.outbox).toEqual([]);
    expect(bare(room.invariants())).toBe('<p>x from A</p><h1>heading</h1>');
  });

  it('relative positions survive remote edits before them', () => {
    const [room, A, B] = open('<p>abc def</p>');
    const position = relativePosition(A.state, A.find('def'));
    B.select(B.blockStart(0)).type('123 ');
    room.sync();
    expect(absolutePosition(A.state, position)).toBe(A.find('def'));
    room.invariants();
  });
});

describe('input', () => {
  it('IME-like composition: a run of replacements of the composed text, with remote typing between them', () => {
    const [room, A, B] = open('<p>start end</p>');
    for (const [composed, length] of [['k', 0], ['か', 1], ['かn', 1], ['かな', 2], ['仮名', 2]] as const) {
      const at = A.find('start ', { after: true });
      A.view.dispatch(A.state.tr.insertText(composed, at, at + length));
      B.select(B.blockStart(0)).type('>');
      room.sync();
    }
    expect(bare(room.invariants())).toBe('<p>&gt;&gt;&gt;&gt;&gt;start 仮名end</p>');
  });

  it('a multi-paragraph HTML paste in the middle of a paragraph while someone types in its tail', () => {
    const [room, A, B] = open('<p>Head tail</p>');
    A.select(A.find('Head ', { after: true })).paste('<p>one</p><h2>two</h2><ul><li>three</li></ul>');
    B.select(B.blockStart(0, true)).type(' [B]');
    expect(bare(room.invariants())).toBe('<p>Head one</p><h2>two</h2><ul><li><p>threetail [B]</p></li></ul>');
  });

  it('undo and redo interleaved with remote edits touch only the undoer\'s own text', () => {
    const [room, A, B] = open('<p>base</p>');
    A.select(A.blockStart(0, true)).type(' A1');
    room.sync();
    B.select(B.blockStart(0, true)).type(' B1');
    room.sync();
    A.select(A.blockStart(0, true)).type(' A2');
    room.sync();
    A.undo();
    B.select(B.blockStart(0, true)).type(' B2');
    room.sync();
    expect(bare(room.invariants())).toBe('<p>base A1 B1 B2</p>');
    A.undo();
    expect(bare(room.invariants())).toBe('<p>base B1 B2</p>');
    A.redo();
    B.select(B.blockStart(0)).type('B0 ');
    expect(bare(room.invariants())).toBe('<p>B0 base A1 B1 B2</p>');
    A.redo();
    expect(bare(room.invariants())).toBe('<p>B0 base A1 B1 A2 B2</p>');
    expect(A.state.selection).toBeInstanceOf(TextSelection);
  });
});
