import {afterAll, describe, expect, it} from 'vitest';
import type {DocumentPrimitive, RichDocument} from '@artifactbin/contracts';
import {getDb, resetDb} from '../../db';
import {compileDocumentOperations} from '../sql';
import {parseDocumentMdx} from '../mdx';
import {assertDocument,diffDocument,moveDocumentNode,splitDocumentBlock,joinDocumentBlocks,removeDocumentNodes} from '../model';

const fixture = (): RichDocument => ({schemaVersion:1,rootId:'root',nodes:{root:{type:'document',props:{},children:['p']},p:{type:'paragraph',props:{},content:[{type:'text',text:'a😀bc',marks:[]}]}}});
afterAll(resetDb);
async function run(ops:DocumentPrimitive[],document=fixture()) {
 const compiled=compileDocumentOperations(ops,[JSON.stringify(document)]);
 return (await (await getDb()).query<{document:RichDocument}>(`WITH input AS (SELECT $1::jsonb AS document), ${compiled.ctes} SELECT document FROM ${compiled.result}`,compiled.params)).rows[0]?.document;
}
describe('native JSONB operation compiler',()=>{
 it('composes text and nested property edits using Unicode code points',async()=>{
  const result=await run([{kind:'text',nodeId:'p',path:['content','0','text'],start:1,deleteCount:1,text:'🦋'},{kind:'set',nodeId:'p',path:['props','className'],value:"x'); DROP TABLE artifacts; --"}]);
  expect(result?.nodes.p.content?.[0]).toMatchObject({text:'a🦋bc'});
  expect(result?.nodes.p.props.className).toBe("x'); DROP TABLE artifacts; --");
 });
 it('adds nodes, inserts/removes IDs and removes nodes atomically',async()=>{
  const result=await run([{kind:'addNodes',nodes:{q:{type:'paragraph',props:{},content:[]}}},{kind:'insert',nodeId:'root',path:['children'],index:1,value:'q'},{kind:'remove',nodeId:'root',path:['children'],index:0},{kind:'removeNodes',ids:['p']}]);
  expect(result?.nodes.root.children).toEqual(['q']);expect(result?.nodes.p).toBeUndefined();expect(result?.nodes.q.type).toBe('paragraph');
 });
 it.each<DocumentPrimitive>([
  {kind:'set',nodeId:'missing',path:['props','x'],value:1},
  {kind:'set',nodeId:'p',path:['missing','x'],value:1},
  {kind:'text',nodeId:'p',path:['content','0','text'],start:4,deleteCount:1,text:''},
  {kind:'text',nodeId:'p',path:['props'],start:0,deleteCount:0,text:''},
  {kind:'insert',nodeId:'root',path:['children'],index:2,value:'q'},
  {kind:'remove',nodeId:'root',path:['children'],index:1},
  {kind:'unset',nodeId:'p',path:['props','absent']},
  {kind:'addNodes',nodes:{p:{type:'paragraph',props:{},content:[]}}},
  {kind:'removeNodes',ids:['root']},
 ])('rejects an invalid operation without a partial result: %j',async operation=>{
  expect(await run([{kind:'set',nodeId:'p',path:['props','x'],value:1},operation])).toBeUndefined();
 });
 it('supports insertion at the end and optional-field removal',async()=>{
  const result=await run([{kind:'set',nodeId:'p',path:['props','x'],value:null},{kind:'unset',nodeId:'p',path:['props','x']},{kind:'insert',nodeId:'p',path:['content'],index:1,value:{type:'break'}}]);
  expect(result?.nodes.p.props).toEqual({});expect(result?.nodes.p.content).toHaveLength(2);
 });
 it('does not expand arrays or create database functions',()=>{
  const sql=compileDocumentOperations([{kind:'insert',nodeId:'root',path:['children'],index:0,value:'q'}]).ctes;
  expect(sql).not.toMatch(/jsonb_array_elements|CREATE FUNCTION|jsonb_agg/i);
 });
});
it('rejects offsets outside PostgreSQL integer bounds before executing SQL',()=>{
 expect(()=>compileDocumentOperations([{kind:'text',nodeId:'p',path:['content','0','text'],start:2**40,deleteCount:0,text:''}])).toThrow(/range/);
 expect(()=>compileDocumentOperations([{kind:'remove',nodeId:'p',path:['content'],index:2**40}])).toThrow(/index/);
});

it('matches the invariant oracle across composed structural edits, undo and iframe source changes',async()=>{
 let current=parseDocumentMdx('<Flex direction="row">\n\nA **Unicode 🦋** paragraph\n\nAnother paragraph\n\n</Flex>\n\n<Iframe title="Demo"><p>Hello</p></Iframe>');
 const flex=Object.keys(current.nodes).find(id=>current.nodes[id].name==='Flex')!,[a,b]=current.nodes[flex].children!;
 const states=[current];
 states.push(splitDocumentBlock(current,a,3,'split'));
 states.push(joinDocumentBlocks(states.at(-1)!,a,'split'));
 states.push(moveDocumentNode(states.at(-1)!,b,current.rootId,1));
 states.push(removeDocumentNodes(states.at(-1)!,[flex],'empty'));
 for(const next of [...states.slice(1),...states.slice(0,-1).reverse()]){
  const result=await run(diffDocument(current,next),current);assertDocument(result);expect(result).toEqual(next);current=next;
 }
 const after=structuredClone(current),iframe=Object.values(after.nodes).find(n=>n.name==='Iframe')!;iframe.text='<p>Changed &amp; still safe</p>';
 expect(await run(diffDocument(current,after),current)).toEqual(after);
});
