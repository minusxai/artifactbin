/**
 * Internal: edit rectangular Markdown tables, keep their header row and move the caret by cell.
 * Used by the shared Markdown editor's toolbar and keyboard commands.
 */
import { Fragment, type Node as ProseNode } from 'prosemirror-model';
import { Plugin, Selection, TextSelection, type Command, type EditorState,
  type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

/** Preserve all cells after a paste or cross-cell edit while restoring GFM's rectangular shape. */
function rectangularizeTable(table: ProseNode): ProseNode {
  const { tableHeader, tableCell } = table.type.schema.nodes;
  const head = table.firstChild!;
  let width = head.childCount;
  table.forEach(row => { width = Math.max(width, row.childCount); });
  const columnAlign = (column: number) => head.maybeChild(column)?.attrs.align ?? null;
  const rows = table.content.content.map((row, index) => {
    const type = index === 0 ? tableHeader! : tableCell!;
    if (row.childCount === width && row.content.content.every((cell, column) =>
      cell.type === type && cell.attrs.align === columnAlign(column))) return row;
    const cells = Array.from({ length: width }, (_, column) => {
      const cell = row.maybeChild(column);
      return type.create({ align: columnAlign(column) }, cell?.content);
    });
    return row.copy(Fragment.fromArray(cells));
  });
  return rows.every((row, index) => row === table.child(index))
    ? table : table.copy(Fragment.fromArray(rows));
}

function cellAt(state: EditorState) {
  const { $from } = state.selection;
  const depth = $from.depth - 2;
  if (depth < 1 || $from.node(depth).type.name !== 'table') return;
  return { table: $from.node(depth), start: $from.before(depth), row: $from.index(depth),
    column: $from.index(depth + 1), cellStart: $from.before(depth + 2) };
}

export const inTable = (state: EditorState): boolean => !!cellAt(state);

function rowStart(table: ProseNode, start: number, row: number) {
  let pos = start + 1;
  for (let i = 0; i < row; i++) pos += table.child(i).nodeSize;
  return pos;
}

function cellStart(table: ProseNode, start: number, row: number, column: number) {
  let pos = rowStart(table, start, row) + 1;
  for (let i = 0; i < column; i++) pos += table.child(row).child(i).nodeSize;
  return pos;
}

function focusCell(tr: Transaction, start: number, row: number, column: number) {
  const pos = cellStart(tr.doc.nodeAt(start)!, start, row, column) + 1;
  return tr.setSelection(TextSelection.create(tr.doc, pos)).scrollIntoView();
}

export const maxDimension = 100;
export const insertTable = (rows: number, columns: number): Command => (state, dispatch) => {
  if (![rows, columns].every(n => Number.isInteger(n) && n >= 1 && n <= maxDimension) ||
      state.selection.$from.depth !== 1 || state.selection.$to.depth !== 1 ||
      state.selection.$from.parent.type.spec.code) return false;
  if (!dispatch) return true;
  const schema = state.schema;
  const table = schema.node('table', null, Array.from({ length: rows }, (_, r) =>
    schema.node('tableRow', null, Array.from({ length: columns }, () =>
      schema.node(r === 0 ? 'tableHeader' : 'tableCell')))));
  const tr = state.tr.replaceSelectionWith(table);
  // At a paragraph edge ProseMirror places the table just outside the original selection.
  let start = -1;
  tr.doc.forEach((node, pos) => { if (node === table) start = pos; });
  if (start < 0) return false;
  dispatch(focusCell(tr, start, 0, 0));
  return true;
};

type Change = 'row-after' | 'column-after' | 'delete-column' | 'delete-row' | 'delete-table';
export const editTable = (action: Change): Command => (state, dispatch) => {
  const here = cellAt(state);
  if (!here) return false;
  const { table, start, row, column } = here;
  if (action === 'delete-row' && row === 0) return false;
  if (action === 'delete-column' && table.child(0).childCount === 1) return false;
  if (!dispatch) return true;
  const tr = state.tr;
  if (action === 'delete-table') {
    tr.delete(start, start + table.nodeSize);
    dispatch(tr.setSelection(Selection.near(tr.doc.resolve(start))).scrollIntoView());
    return true;
  }
  let nextRow = row, nextColumn = column;
  if (action === 'row-after') {
    const cells: ProseNode[] = [];
    const { tableCell, tableRow } = state.schema.nodes;
    table.firstChild!.forEach(header => cells.push(tableCell!.create(header.attrs)));
    tr.insert(rowStart(table, start, row + 1), tableRow!.create(null, cells));
    nextRow++;
  } else if (action === 'delete-row') {
    const pos = rowStart(table, start, row);
    tr.delete(pos, pos + table.child(row).nodeSize);
    nextRow = Math.min(row, table.childCount - 2);
  } else {
    // Edit from the bottom so every remaining position still refers to the original table.
    const add = action === 'column-after';
    for (let r = table.childCount - 1; r >= 0; r--) {
      const pos = cellStart(table, start, r, column);
      const current = table.child(r).child(column);
      if (add) tr.insert(pos + current.nodeSize, current.type.create());
      else tr.delete(pos, pos + current.nodeSize);
    }
    nextColumn = add ? column + 1 : Math.min(column, table.firstChild!.childCount - 2);
  }
  dispatch(focusCell(tr, start, nextRow, nextColumn));
  return true;
};

export const moveCell = (direction: 'next' | 'previous' | 'down'): Command =>
  (state, dispatch) => {
    const here = cellAt(state);
    if (!here) return false;
    const { table, start, row, column } = here;
    const width = table.firstChild!.childCount;
    const next = row * width + column + (direction === 'down' ? width :
      direction === 'next' ? 1 : -1);
    if (next < 0) return false;
    if (next < table.childCount * width) {
      dispatch?.(focusCell(state.tr, start, Math.floor(next / width), next % width));
      return true;
    }
    if (direction === 'next') {
      // Tabbing out of the last cell starts the next body row.
      if (!dispatch) return true;
      return editTable('row-after')(state, tr =>
        dispatch(focusCell(tr, start, row + 1, 0)));
    }
    const after = start + table.nodeSize;
    if (dispatch) {
      const tr = state.tr;
      const following = Selection.findFrom(tr.doc.resolve(after), 1, true);
      if (following) tr.setSelection(following);
      else {
        tr.insert(after, state.schema.node('paragraph'));
        tr.setSelection(TextSelection.create(tr.doc, after + 1));
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };

// A cross-cell selection can join parts of two rows. Fix the touched table in the same undo
// event. Small markup/insert steps let ProseMirror map the original caret through the repair.
function repairTable(tr: Transaction, table: ProseNode, start: number) {
  const grid = rectangularizeTable(table);
  if (grid === table) return;
  table.forEach((row, offset, r) => {
    const expected = grid.child(r);
    const before = start + offset + 1;
    row.forEach((cell, cellOffset, c) => {
      const normalized = expected.child(c);
      if (!cell.sameMarkup(normalized)) {
        tr.setNodeMarkup(tr.mapping.map(before + cellOffset + 1), normalized.type,
          normalized.attrs);
      }
    });
    if (row.childCount < expected.childCount) {
      tr.insert(tr.mapping.map(before + row.nodeSize - 1),
        expected.content.content.slice(row.childCount));
    }
  });
}

export const tableFocus = new Plugin({
  appendTransaction(transactions, oldState, state) {
    if (!transactions.some(tr => tr.docChanged)) return null;
    const before = oldState.doc.content, after = state.doc.content;
    const from = before.findDiffStart(after), end = before.findDiffEnd(after);
    if (from === null || !end) return null;
    const $start = state.doc.resolve(from);
    // Typing inside a single existing cell cannot change the shape of its table.
    if ($start.parent.isTextblock && $start.sameParent(state.doc.resolve(end.b)) &&
        oldState.doc.resolve(from).sameParent(oldState.doc.resolve(end.a))) return null;
    const tr = state.tr;
    state.doc.nodesBetween(from, Math.max(from, end.b), (node, pos) => {
      if (node.type.name !== 'table') return;
      repairTable(tr, node, pos);
      return false;
    });
    return tr.docChanged ? tr : null;
  },
  props: { decorations(state) {
    const here = cellAt(state);
    if (!here) return null;
    const end = here.cellStart + here.table.child(here.row).child(here.column).nodeSize;
    return DecorationSet.create(state.doc, [
      Decoration.node(here.cellStart, end, { class: 'af-md-active-cell' }),
    ]);
  } },
});
