import {afterAll, describe, expect, it} from 'vitest';
import type {DocumentPrimitive, RichDocument} from '@artifactbin/contracts';
import {getDb, resetDb} from '../../db';
import {compileDocumentOperations} from '../sql';

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
