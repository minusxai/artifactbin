import { it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { editorDocument } from '../model';
import { mergeIdentityMaps } from '../annotation-map';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
it('maps a surviving suffix by transaction positions, even with repeated words', () => {
  const parsed = parseJsxOrThrow('<p id="a">same same</p><p id="b">same same</p>');
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
