import {describe, expect, it} from 'vitest';
import type {RichDocument} from '@artifactbin/contracts';
import {applyDocumentOperations, documentChanges, moveDocumentNode, splitDocumentBlock, joinDocumentBlocks, assertDocument, diffDocument, removeDocumentNodes} from '../model';

export const fixture = (): RichDocument => ({schemaVersion:1,rootId:'root',nodes:{
 root:{type:'document',props:{},children:['A','C']},
 A:{type:'component',name:'Flex',props:{direction:'row',sizes:[1,1]},children:['B','D']},
 B:{type:'paragraph',props:{},content:[{type:'text',text:'a😀bc',marks:[{type:'strong'}]}]},
 D:{type:'paragraph',props:{},content:[{type:'text',text:'other',marks:[]}]},
 C:{type:'component',name:'Flex',props:{direction:'column',sizes:[1]},children:['E']},
 E:{type:'paragraph',props:{},content:[]},
}});

describe('canonical document invariants',()=>{
 it('accepts a normalized tree',()=>expect(()=>assertDocument(fixture())).not.toThrow());
 it.each(['cycle','orphan','missing','duplicate','sizes','float','depth'])('rejects %s',kind=>{
  const d=fixture();
  if(kind==='cycle')d.nodes.A.children=['root'];
  if(kind==='orphan')d.nodes.X={type:'paragraph',props:{},content:[]};
  if(kind==='missing')d.nodes.A.children=['missing','D'];
  if(kind==='duplicate')d.nodes.C.children=['B'];
  if(kind==='sizes')d.nodes.A.props.sizes=[1];
  if(kind==='float')d.nodes.B.props.float='up';
  if(kind==='depth'){d.nodes.B.type='heading';d.nodes.B.props.depth=8;}
  expect(()=>assertDocument(d)).toThrow();
 });
});
describe('discrete operations',()=>{
 it('splices by code point without mutating the input',()=>{
  const d=fixture();const next=applyDocumentOperations(d,[{kind:'text',nodeId:'B',path:['content','0','text'],start:1,deleteCount:1,text:'X'}]);
  expect(next.nodes.B.content?.[0]).toMatchObject({text:'aXbc'});expect(d.nodes.B.content?.[0]).toMatchObject({text:'a😀bc'});
 });
 it('rejects missing paths and invalid offsets',()=>{
  expect(()=>applyDocumentOperations(fixture(),[{kind:'set',nodeId:'B',path:['missing','x'],value:1}])).toThrow();
  expect(()=>applyDocumentOperations(fixture(),[{kind:'text',nodeId:'B',path:['content','0','text'],start:8,deleteCount:0,text:'!'}])).toThrow();
 });
 it('replaces a local array and derives a minimal replayable diff',()=>{
  const d=fixture(),next=structuredClone(d);next.nodes.B.content=[{type:'text',text:'new',marks:[]}];
  const ops=diffDocument(d,next);expect(ops.every(o=>'nodeId'in o && o.nodeId==='B')).toBe(true);
  expect(applyDocumentOperations(d,ops)).toEqual(next);
 });
});
describe('structural commands',()=>{
 it('moves between parents and keeps size/identity ownership aligned',()=>{
  const before=fixture(),after=moveDocumentNode(before,'B','C',1);assertDocument(after);
  expect(after.nodes.A.children).toEqual(['D']);expect(after.nodes.C.children).toEqual(['E','B']);expect(after.nodes.B).toEqual(before.nodes.B);
  expect(after.nodes.A.props.sizes).toEqual([1]);expect(after.nodes.C.props.sizes).toEqual([1,1]);
  const changes=documentChanges(before,after);expect(changes.changedIds).toEqual(expect.arrayContaining(['A','B','C']));expect(changes.ancestorIds).toEqual(expect.arrayContaining(['root','A','C']));
 });
 it('reorders against the post-removal index',()=>expect(moveDocumentNode(fixture(),'B','A',1).nodes.A.children).toEqual(['D','B']));
 it('rejects cyclic placement and root moves',()=>{
  expect(()=>moveDocumentNode(fixture(),'A','B',0)).toThrow();expect(()=>moveDocumentNode(fixture(),'root','A',0)).toThrow();
 });
 it('splits marks and keeps left identity; joining reverses it',()=>{
  const before=fixture(),after=splitDocumentBlock(before,'B',2,'new');assertDocument(after);
  expect(after.nodes.B.content?.[0]).toMatchObject({text:'a😀'});expect(after.nodes.new.content?.[0]).toMatchObject({text:'bc',marks:[{type:'strong'}]});
  expect(joinDocumentBlocks(after,'B','new')).toEqual(before);
 });
 it('deletes subtrees and retains an editable empty paragraph',()=>{
  const after=removeDocumentNodes(fixture(),['A','B'],'blank');assertDocument(after);expect(after.nodes.A).toBeUndefined();expect(after.nodes.B).toBeUndefined();
  const empty=removeDocumentNodes(fixture(),['A','C'],'blank');assertDocument(empty);expect(empty.nodes.root.children).toEqual(['blank']);
 });
 it('unrelated sibling edits share ancestors without sharing targets',()=>{
  const before=fixture(),after=structuredClone(before);after.nodes.B.props.className='font-mono';
  expect(documentChanges(before,after)).toEqual({changedIds:['B'],ancestorIds:['A','root']});
 });
});
it('ignores JSONB object key ordering when deriving edits',()=>{
 const before=fixture();
 const reorder=(value:unknown):unknown=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reorder(v)])):value;
 const after=reorder(before) as RichDocument;
 expect(diffDocument(before,after)).toEqual([]);expect(documentChanges(before,after).changedIds).toEqual([]);
});
it('compiles typing to one code-point splice inside its text run',()=>{
 const before=fixture(),after=structuredClone(before);after.nodes.B.content=[{type:'text',text:'a🦋bc!',marks:[{type:'strong'}]}];
 const ops=diffDocument(before,after);expect(ops).toEqual([{kind:'text',nodeId:'B',path:['content','0','text'],start:1,deleteCount:3,text:'🦋bc!'}]);
 expect(applyDocumentOperations(before,ops)).toEqual(after);
});
