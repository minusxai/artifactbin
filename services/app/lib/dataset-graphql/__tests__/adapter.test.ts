import {describe,it,expect} from 'vitest';
import {createDatasetGraphql} from '../index';
import {ID_COLUMN,tableIdentity,columnIdentity} from '../model';
import type {DatasetGraphqlPort,DatasetSnapshot} from '../types';
const table={schema:'public',name:'rows',columns:[{name:'amount',type:'number' as const}],objectKey:'blob'};
const actor={userId:'viewer',tokenId:null,email:null,documentEditor:false},binding={kind:'dataset' as const,name:'data',datasetId:'dataset',mode:'live' as const};
const signal=new AbortController().signal;
const request={tableId:tableIdentity(table),first:1};
function setup(){
 const snapshot:DatasetSnapshot={id:'dataset',revision:'1',policyIdentity:'policy1',catalog:{kind:'stored',defaultSchema:'public',refreshSeconds:0,tables:[table]},rowIds:{}};
 let allowed=true,commits=0;
 const port:DatasetGraphqlPort={snapshot:async()=>{if(!allowed)throw new Error('denied');return snapshot;},execute:async(_a,_s,_t,_q,window)=>[{amount:3.5,[ID_COLUMN]:'first'},{amount:null,[ID_COLUMN]:'second'}].slice(window.offset,window.offset+window.limit),commit:async(_a,_b,_s,input,statements)=>{commits++;return {requestId:input.requestId,revision:'2',outcome:'committed',rowIds:statements.map(s=>String(s.params.rowId))};}};
 return {api:createDatasetGraphql(port),snapshot,revoke:()=>{allowed=false;},commits:()=>commits};
}
describe('dataset adapter',()=>{
 it('paginates projected typed cells with stable row IDs',async()=>{
  const {api}=setup(),first=await api.read(actor,binding,request,signal);
  expect(first.rows).toEqual([{id:'first',cells:[{columnId:columnIdentity(request.tableId,'amount'),value:{type:'NUMBER',value:3.5}}]}]);
  expect(first.pageInfo.hasNextPage).toBe(true);
  const next=await api.read(actor,binding,{...request,after:first.pageInfo.endCursor!},signal);
  expect(next.rows[0]!.id).toBe('second');expect(next.rows[0]!.cells[0]!.value.value).toBe(null);
 });
 it('refuses continuation after revision or query changes',async()=>{
  const {api,snapshot}=setup(),first=await api.read(actor,binding,request,signal);
  await expect(api.read(actor,binding,{...request,first:2,after:first.pageInfo.endCursor!},signal)).rejects.toThrow('stale_cursor');
  snapshot.revision='2';await expect(api.read(actor,binding,{...request,after:first.pageInfo.endCursor!},signal)).rejects.toThrow('stale_cursor');
 });
 it('checks live dataset authorization before a cursor',async()=>{
  const s=setup(),first=await s.api.read(actor,binding,request,signal);s.revoke();
  await expect(s.api.read(actor,binding,{...request,after:first.pageInfo.endCursor!},signal)).rejects.toThrow('denied');
 });
 it('refuses pinned writes without entering commit boundary',async()=>{
  const s=setup();expect((await s.api.write(actor,{...binding,mode:'pinned',revision:'1'},{tableId:request.tableId,expectedRevision:'1',requestId:'request',changes:[{kind:'DELETE',rowId:'first'}]},signal)).outcome).toBe('rejected');expect(s.commits()).toBe(0);
 });
 it('keeps inserted identity on an identical request retry',async()=>{
  const {api}=setup(),input={tableId:request.tableId,expectedRevision:'1',requestId:'same-request',changes:[{kind:'INSERT' as const,cells:[{columnId:columnIdentity(request.tableId,'amount'),value:{type:'NUMBER' as const,value:1}}]}]};
  expect((await api.write(actor,binding,input,signal)).rowIds).toEqual((await api.write(actor,binding,input,signal)).rowIds);
 });
});
