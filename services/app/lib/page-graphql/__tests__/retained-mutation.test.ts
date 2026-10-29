import {it,expect,vi,beforeEach} from 'vitest';
import type {HtmlPageVersion,Queryable} from '@artifactbin/contracts';
const state=vi.hoisted(()=>({doc:{} as Record<string,unknown>,dataset:{} as Record<string,unknown>,page:{} as HtmlPageVersion,backend:{} as Record<string,unknown>,commits:0,change:false,proof:undefined as undefined|((tx:Queryable)=>Promise<void>),calls:[] as unknown[]}));
vi.mock('@/lib/artifact-access',()=>({writerFor:()=>({}),grantsOf:()=>null,grantContext:async()=>({}),can:async()=>true,attestRegisteredHtmlMutation:(_id:string,_edit:string,verify:(tx:Queryable)=>Promise<void>)=>{state.proof=verify;return {};}}));
vi.mock('@/lib/artifacts',()=>({getArtifactById:async(id:string)=>id==='page'?state.doc:state.dataset,getArtifactFor:async()=>state.dataset,canReadArtifact:async()=>true,pinMutationContext:async()=>{},artifactState:()=> 'dataset-state',durableMutation:async(_actor:unknown,_origin:string,_key:string,_payload:unknown,work:(receipt:unknown)=>Promise<unknown>)=>work({})}));
vi.mock('@/lib/html-publication',()=>({readHtmlPage:async()=>state.page}));
vi.mock('@/lib/html-backends',()=>({getHtmlBackendVersion:async()=>state.backend}));
vi.mock('@/lib/document-data',()=>({canWriteDataset:async()=>null,isMutationRefused:(value:unknown)=>!!value&&typeof value==='object'&&'reason'in value,mutateDataset:async(_dataset:unknown,_actor:unknown,_sql:string,_params:unknown,guard:unknown)=>{
 state.calls.push(guard);if(state.change)state.doc={...state.doc,source:'changed'};
 const tx={query:async(sql:string)=>({rows:sql.includes('artifact_versions')?[{source:state.page.html,meta:{htmlLinks:state.page.links}}]:sql.includes('html_backend_versions')?[{backend_id:state.backend.backendId,page_id:state.backend.pageId,version:state.backend.version,name:state.backend.name,source:state.backend.source,type_defs:state.backend.typeDefs,compiled:state.backend.compiled,owner_id:state.backend.ownerId,secret_bindings:[]}]:[state.doc]})} as unknown as Queryable;
 await state.proof!(tx);state.commits++;return {row:{id:'data',version:2},affected:1,rowCount:1};
}}));
import {prepareRegisteredMutationBackend} from '@/lib/registered-page-mutations';
import {createRetainedRegisteredMutation} from '../registered-mutations';
import type {MutationProgram} from '@/lib/registered-page-mutations';
const actor={userId:'account',tokenId:null,email:null,documentEditor:false},digest='a'.repeat(64),program:MutationProgram={name:'save',kind:'insert',sql:'INSERT INTO form.rows(body) VALUES ($body)',target:{datasetId:'data',schema:'form',table:'rows'},values:{body:{type:'string',nullable:false,parameter:'body'}},builtins:[],expectedAffected:1,reset:['body']};
beforeEach(()=>{state.commits=0;state.change=false;state.calls=[];state.dataset={id:'data'};const page:HtmlPageVersion={pageId:'page',version:1,revision:'1',html:'<p>Example</p>',links:[],nextNodeId:1};const prepared=prepareRegisteredMutationBackend('actions','backend',page,program,{compilerSha256:digest,sourceSha256:digest});state.page={...page,links:[prepared.link]};state.backend={...prepared.backend,...prepared.link,pageId:'page',ownerId:'owner'};state.doc={id:'page',format:'html',version:1,edit_id:'edit',user_id:'owner',source:page.html};});
it('retained adapter forwards expectedAffected rollback and document proof to original transaction port',async()=>{
 const service=createRetainedRegisteredMutation(actor,state.page,state.page.links[0] as Parameters<typeof createRetainedRegisteredMutation>[2],state.backend as unknown as Parameters<typeof createRetainedRegisteredMutation>[3],async()=>actor);
 const result=await service.execute({requestId:'request_1234567890',values:{body:'x'}},new AbortController().signal);expect(result).toMatchObject({outcome:'committed',affected:1,reset:['body']});expect(state.commits).toBe(1);expect(state.calls[0]).toMatchObject({expectedAffected:1,document:{id:'page',editId:'edit',registeredHtml:{}}});
});
it('source changed during SQL refuses at transaction fence and never reports committed/reset',async()=>{
 const service=createRetainedRegisteredMutation(actor,state.page,state.page.links[0] as Parameters<typeof createRetainedRegisteredMutation>[2],state.backend as unknown as Parameters<typeof createRetainedRegisteredMutation>[3],async()=>actor);state.change=true;
 await expect(service.execute({requestId:'request_1234567890',values:{body:'x'}},new AbortController().signal)).rejects.toThrow('registered_mutation_unavailable');expect(state.commits).toBe(0);
});

it('rejects anonymous and token-only callers before creating a retained mutation service',()=>{
 for(const anonymous of [{...actor,userId:null},{...actor,userId:null,tokenId:'legacy-token'}])expect(()=>createRetainedRegisteredMutation(anonymous,state.page,state.page.links[0] as Parameters<typeof createRetainedRegisteredMutation>[2],state.backend as unknown as Parameters<typeof createRetainedRegisteredMutation>[3],async()=>anonymous)).toThrow('registered_mutation_account_required');
 expect(state.commits).toBe(0);
});
