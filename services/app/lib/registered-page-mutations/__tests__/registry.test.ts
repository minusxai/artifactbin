import {it,expect} from 'vitest';
import type {HtmlPageVersion} from '@artifactbin/contracts';
import {prepareRegisteredMutationBackend,registeredMutationPlan,registeredMutationDescriptor,registeredMutationSchema,registeredMutationInvoker,commitRegisteredMutationBackend} from '../index';
import type {MutationProgram} from '../index';
const digest='a'.repeat(64),program:MutationProgram={name:'save',kind:'insert',sql:'INSERT INTO form.rows(body) VALUES ($body)',target:{datasetId:'private-dataset',schema:'form',table:'rows'},values:{body:{type:'string',nullable:false,parameter:'body'}},builtins:[],expectedAffected:1,reset:['body']};
const page:HtmlPageVersion={pageId:'page',version:1,revision:'1',html:'<p data-af-id="n1">Synthetic</p>',nextNodeId:2,links:[]};
it('registration binds immutable HTML, program, provenance and backend bytes while public descriptors contain only typed values',()=>{
 const prepared=prepareRegisteredMutationBackend('actions','backend',page,program,{compilerSha256:digest,sourceSha256:digest});const saved={...page,links:[prepared.link]},record={...prepared.backend,...prepared.link,pageId:page.pageId,ownerId:'owner',secretBindings:[]};
 const plan=registeredMutationPlan(saved,prepared.link,record);expect(plan?.name).toBe('save');expect(()=>registeredMutationPlan({...saved,html:'changed'},prepared.link,record)).toThrow();expect(()=>registeredMutationPlan(saved,prepared.link,{...record,compiled:record.compiled+' '})).toThrow();expect(()=>registeredMutationPlan({...saved,links:[]},prepared.link,record)).toThrow();
 expect(registeredMutationSchema(program)).toContain('run(requestId:String!,values:Values!)');
 const descriptor=registeredMutationDescriptor('actions',program);expect(descriptor.outcomePath).toEqual(['actions','run']);expect(JSON.stringify(descriptor)).not.toMatch(/private-dataset|INSERT|form\.rows|parameter/);expect(descriptor.values).toEqual([{name:'body',type:'string',nullable:false}]);
 expect(typeof registeredMutationInvoker).toBe('function');expect(typeof commitRegisteredMutationBackend).toBe('function');
});
it('public typed descriptor executes through the real page GraphQL composer and reports adapter outcome',async()=>{
 const {composePageSchema,executePageOperation}=await import('@/lib/page-operations');
 const prepared=prepareRegisteredMutationBackend('actions','backend',page,program,{compilerSha256:digest,sourceSha256:digest});const saved={...page,links:[prepared.link]},record={...prepared.backend,...prepared.link,pageId:page.pageId,ownerId:'owner',secretBindings:[]};const plan=registeredMutationPlan(saved,prepared.link,record)!;
 const context={...plan.registration,subject:'viewer',callerKey:'credential'},descriptor=registeredMutationDescriptor('actions',program);
 const invoke=registeredMutationInvoker(context,plan,async(_context,_plan,input)=>{expect(input).toEqual({requestId:'request_1234567890',values:{body:'Hello'}});return {requestId:'request_1234567890',outcome:'rejected',revision:null,affected:null,reset:[]};});
 const schema=composePageSchema([{name:'actions',fileId:'backend',version:prepared.link.version,typeDefs:prepared.backend.typeDefs}]);
 const result=await executePageOperation({schema,request:{query:descriptor.document,variables:{requestId:'request_1234567890',values:{body:'Hello'}}},caller:{pageId:'page',subject:'viewer',role:'VIEWER'},invoke,signal:new AbortController().signal});
 expect(result.errors).toBeUndefined();expect(result.extensions?.outcomes).toEqual({'actions.run':'rejected'});expect(result.data).toMatchObject({actions:{run:{outcome:'rejected',reset:[]}}});
});

it('GraphQL applies immutable scalar defaults when defaulted non-null inputs are omitted',async()=>{
 const {composePageSchema,executePageOperation}=await import('@/lib/page-operations');
 const body='Quoted "text"\nsecond line';
 const defaulted:MutationProgram={...program,values:{body:{type:'string',nullable:false,parameter:'body',default:body},count:{type:'number',nullable:false,parameter:'count',default:0},enabled:{type:'boolean',nullable:false,parameter:'enabled',default:false},optional:{type:'string',nullable:true,parameter:'optional',default:null}}};
 const descriptor=registeredMutationDescriptor('actions',defaulted);
 const schema=composePageSchema([{name:'actions',fileId:'backend',version:'v1',typeDefs:registeredMutationSchema(defaulted)}]);
 let calls=0;
 const result=await executePageOperation({schema,request:{query:descriptor.document,variables:{requestId:'request_1234567890',values:{}}},caller:{pageId:'page',subject:'viewer',role:'VIEWER'},invoke:async call=>{calls++;expect(call.args.values).toEqual({body,count:0,enabled:false,optional:null});return {requestId:'request_1234567890',outcome:'committed',revision:'2',affected:1,reset:[]};},signal:new AbortController().signal});
 expect(result.errors).toBeUndefined();expect(calls).toBe(1);expect(result.data).toMatchObject({actions:{run:{outcome:'committed'}}});
 const invalid=await executePageOperation({schema,request:{query:descriptor.document,variables:{requestId:'request_1234567890',values:{body:null}}},caller:{pageId:'page',subject:'viewer',role:'VIEWER'},invoke:async()=>{calls++;return null;},signal:new AbortController().signal});
 expect(invalid.errors?.length).toBeGreaterThan(0);expect(calls).toBe(1);
});

it('keeps legacy registration bytes and exposes only the opt-in nullable refusal enum through GraphQL',async()=>{
 const {composePageSchema,executePageOperation}=await import('@/lib/page-operations');
 expect(registeredMutationSchema(program)).toBe('input Values {body:String!} type Outcome {requestId:String! outcome:String! revision:String affected:Int reset:[String!]!} type Mutation {run(requestId:String!,values:Values!):Outcome!}');
 expect(registeredMutationDescriptor('actions',program).document).not.toContain('reason');
 const declared:MutationProgram={...program,refusalReasons:'conflict-v1'},prepared=prepareRegisteredMutationBackend('actions','backend',page,declared,{compilerSha256:digest,sourceSha256:digest}),saved={...page,links:[prepared.link]},record={...prepared.backend,...prepared.link,pageId:page.pageId,ownerId:'owner',secretBindings:[]};
 const plan=registeredMutationPlan(saved,prepared.link,record)!;expect(plan.refusalReasons).toBe('conflict-v1');
 const schema=composePageSchema([{name:'actions',fileId:'backend',version:prepared.link.version,typeDefs:prepared.backend.typeDefs}]),descriptor=registeredMutationDescriptor('actions',declared);
 for(const reason of ['row_changed','row_not_unique',null]){
  const result=await executePageOperation({schema,request:{query:descriptor.document,variables:{requestId:'request_reason_123456',values:{body:'x'}}},caller:{pageId:'page',subject:'viewer',role:'VIEWER'},invoke:async()=>({requestId:'request_reason_123456',outcome:'rejected',revision:null,affected:null,reset:[],reason}),signal:new AbortController().signal});
  expect(result.errors).toBeUndefined();expect(result.data).toMatchObject({actions:{run:{reason}}});
 }
});
