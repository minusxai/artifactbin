import {describe,expect,it} from 'vitest';
import {TextSelection} from 'prosemirror-state';
import {splitBlock,joinBackward,toggleMark} from 'prosemirror-commands';
import {undo,redo} from 'prosemirror-history';
import {createDocumentEditorState,editorDocument,documentEditorSchema} from '../editor';
import {parseDocumentMdx} from '../mdx';
import {assertDocument} from '../model';

describe('one continuous document editor',()=>{
 it('round-trips prose, nested Flex, text marks and opaque components',()=>{
  const d=parseDocumentMdx('# Title\n\n<Flex direction="row" sizes={[1,2]}>\n\nText **bold**.\n\n<Iframe title="Demo"><p>Hello</p></Iframe>\n\n</Flex>');
  expect(editorDocument(createDocumentEditorState(d).doc)).toEqual(d);
 });
 it('splits, types, joins and undoes inside a layout without switching editors',()=>{
  const d=parseDocumentMdx('<Flex direction="row">\n\nHello world\n\n</Flex>');let state=createDocumentEditorState(d);
  const dispatch=(tr:Parameters<typeof state.apply>[0])=>{state=state.applyTransaction(tr).state;};
  dispatch(state.tr.setSelection(TextSelection.create(state.doc,7)));
  expect(splitBlock(state,dispatch)).toBe(true);let next=editorDocument(state.doc);assertDocument(next);
  expect(Object.values(next.nodes).filter(n=>n.type==='paragraph')).toHaveLength(2);
  expect(new Set(Object.keys(next.nodes)).size).toBe(Object.keys(next.nodes).length);
  expect(joinBackward(state,dispatch)).toBe(true);expect(editorDocument(state.doc)).toEqual(d);
  dispatch(state.tr.insertText('!'));expect(undo(state,dispatch)).toBe(true);expect(redo(state,dispatch)).toBe(true);assertDocument(editorDocument(state.doc));
 });
 it('styles only the selected text and preserves its paragraph identity',()=>{
  const d=parseDocumentMdx('Hello world');let state=createDocumentEditorState(d);const dispatch=(tr:Parameters<typeof state.apply>[0])=>{state=state.applyTransaction(tr).state;};
  dispatch(state.tr.setSelection(TextSelection.create(state.doc,1,6)));toggleMark(documentEditorSchema.marks.span,{className:'font-mono'})(state,dispatch);
  const next=editorDocument(state.doc);expect(Object.keys(next.nodes)).toEqual(Object.keys(d.nodes));
  const p=Object.values(next.nodes).find(n=>n.type==='paragraph')!;expect(p.content).toEqual([{type:'text',text:'Hello',marks:[{type:'span',attrs:{className:'font-mono'}}]},{type:'text',text:' world',marks:[]}]);
 });
 it('assigns fresh IDs when pasting a copied node',()=>{
  const d=parseDocumentMdx('Hello');let state=createDocumentEditorState(d);state=state.applyTransaction(state.tr.insert(state.doc.content.size,state.doc.firstChild!)).state;
  const next=editorDocument(state.doc);assertDocument(next);expect(next.nodes[next.rootId].children).toHaveLength(2);
 });
});
it('retains inline component contents and remints the complete subtree on paste',()=>{
 const d=parseDocumentMdx('Hello <Badge>new</Badge>.');let state=createDocumentEditorState(d);
 expect(editorDocument(state.doc)).toEqual(d);
 state=state.applyTransaction(state.tr.insert(state.doc.content.size,state.doc.firstChild!)).state;
 const after=editorDocument(state.doc);assertDocument(after);expect(Object.values(after.nodes).filter(n=>n.name==='Badge')).toHaveLength(2);
});
