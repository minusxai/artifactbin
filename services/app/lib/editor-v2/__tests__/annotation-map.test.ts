import { it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { parseJsx } from '@/lib/jsx';
import { editorDocument } from '../model';
import { mergeIdentityMaps } from '../annotation-map';
it('maps a surviving suffix by transaction positions, even with repeated words', () => {
  const parsed = parseJsx('<p id="a">same same</p><p id="b">same same</p>');
  if (!parsed.ok) throw Error(parsed.error);
  const s = EditorState.create({ doc: editorDocument(parsed.nodes) });
  const tr = s.tr.setSelection(TextSelection.create(s.doc, 6, 17)).insertText('X');
  const maps = mergeIdentityMaps(s.doc, tr);
  expect(maps).toEqual([
    {
      fromId: 'b',
      toId: 'a',
      fromText: 'same same',
      toText: 'same Xsame',
      segments: [{ from: 5, to: 6, length: 4 }],
    },
  ]);
});
