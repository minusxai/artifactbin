import { beforeEach,describe,expect,it,vi } from 'vitest';

const state=vi.hoisted(()=>({
  doc:{id:'doc123',edit_id:'edit123',format:'markup',deleted_at:null,user_id:'owner',token_id:'owner-token',source:'<Helmet />',meta:{},visibility:'private',link_role:null},
  dataset:{id:'data12',edit_id:'dataset-edit',format:'dataset',deleted_at:null,user_id:'owner',token_id:'owner-token',meta:{},visibility:'private',link_role:null,dataset_policy:{version:2,allow:[{actions:['insert','read'],from:{artifact:'doc123'}}]},policy_revision:1},
  records:[] as Array<Record<string,any>>,readAllowed:true, put:vi.fn(), get:vi.fn(async()=>Buffer.from('optimized')),
}));

vi.mock('@/lib/platform/db',()=>({getDb:async()=>({
  query:async()=>({rows:[],rowCount:0}),
  transaction:async(fn:(tx:any)=>Promise<unknown>)=>{
    const tx={query:async(sql:string,params:unknown[]=[])=>{
      if(sql.includes('FROM dataset_images')&&sql.includes('operation_key')){
        const row=state.records.find(row=>row.dataset_id===params[0]&&row.actor_id===params[1]&&row.operation_key===params[2]);return {rows:row?[row]:[],rowCount:row?1:0};
      }
      if(sql.includes('count(*)'))return {rows:[{count:String(state.records.length),bytes:String(state.records.reduce((n,r)=>n+Number(r.meta.bytes),0))}],rowCount:1};
      if(sql.includes('INSERT INTO dataset_images')){
        const [id,dataset_id,document_id,actor_id,operation_key,sha256,meta]=params as [string,string,string,string,string,string,string];
        const row={id,dataset_id,document_id,actor_id,operation_key,sha256,meta:JSON.parse(meta)};state.records.push(row);return {rows:[],rowCount:1};
      }
      if(sql.includes('FROM dataset_images')&&sql.includes('WHERE id=')){
        const row=state.records.find(row=>row.id===params[0]&&row.dataset_id===params[1]&&row.document_id===params[2]);return {rows:row?[row]:[],rowCount:row?1:0};
      }
      return {rows:[],rowCount:0};
    }};
    return fn(tx);
  },
})}));
vi.mock('@/lib/platform',()=>({generateInternalId:()=> 'abc234def456',ID_RE:/^[A-Za-z0-9]{6,12}$/}));
vi.mock('@/lib/artifacts',()=>({getArtifactById:async(id:string)=>id==='doc123'?state.doc:id==='data12'?state.dataset:null}));
vi.mock('@/lib/artifacts/document',()=>({artifactQuery:async()=>({rows:[state.dataset,state.doc]})}));
vi.mock('@/lib/artifacts/dataflow',()=>({dataflowForRow:async()=>({flow:{imports:[{name:'feedback',ref:'ref:data12'}]}})}));
vi.mock('@/lib/artifacts/access',()=>({canReadArtifact:async()=>true}));
vi.mock('@/lib/datasets/catalog',()=>({catalogOf:(row:any)=>row.format==='dataset'?{kind:'stored'}:null}));
vi.mock('@/lib/datasets/policy/grants',()=>({grantsOf:(row:any)=>row.dataset_policy??null,grantContext:async()=>({caller:{userId:'reporter',tokenId:null},owner:{userId:'owner',tokenId:null},artifact:{id:'doc123',owner:{userId:'owner',tokenId:null}}}),grantsPermitRead:async()=>state.readAllowed,readThrough:async()=>state.readAllowed}));
vi.mock('@/lib/story/data/data-tiers',()=>({storeImageContent:async(bytes:Buffer,type:string)=>({format:'image',meta:{objectKey:'image/object',bytes:bytes.length,contentType:type}})}));
vi.mock('@/lib/object-store',()=>({objectStore:()=>({put:state.put,get:state.get})}));

import { readDatasetImage,uploadDatasetImage } from '../feedback-images';
const actor={userId:'reporter',tokenId:null,email:'reporter@example.test'};
const upload=(bytes=Buffer.from('pixels'),datasetId='data12',editId='edit123')=>uploadDatasetImage({actor,documentId:'doc123',datasetId,editId,bytes,contentType:'image/png',operationKey:'retry-key-123'});

describe('dataset-bound feedback images',()=>{
  beforeEach(()=>{state.records.splice(0);state.readAllowed=true;state.put.mockClear();state.get.mockClear();});
  it('persists an image under the exact imported dataset and replays the same ref for the same bytes/key',async()=>{
    const first=await upload();const replay=await upload();
    expect(first.ref).toBe('dimg:abc234def456');expect(first.url).toContain('/a/doc123/datasets/data12/images/abc234def456');
    expect(replay).toMatchObject({...first,replayed:true});expect(state.records).toHaveLength(1);
  });
  it('rejects a changed body for an existing operation key and stale document edits',async()=>{
    await upload();await expect(upload(Buffer.from('different'))).rejects.toThrow(/already used/);
    await expect(upload(Buffer.from('pixels'),'data12','old-edit')).rejects.toThrow(/unavailable/);
    expect(state.records).toHaveLength(1);
  });
  it('requires the named dataset import and an insert grant before storing bytes',async()=>{
    const wrong=vi.fn();
    await expect(upload(Buffer.from('pixels'),'other1')).rejects.toThrow(/unavailable/);
    expect(wrong).not.toHaveBeenCalled();
    const original=state.dataset.dataset_policy;state.dataset.dataset_policy={version:2,allow:[{actions:['update'],from:{artifact:'doc123'}}]};
    await expect(upload()).rejects.toThrow(/insert grant/);
    state.dataset.dataset_policy=original;expect(state.records).toHaveLength(0);
  });
  it('checks current dataset read access on every image request before loading bytes',async()=>{
    await upload();
    const args={actor,documentId:'doc123',datasetId:'data12',imageId:'abc234def456'};
    expect(await readDatasetImage(args)).toMatchObject({contentType:'image/png'});expect(state.get).toHaveBeenCalledTimes(1);
    state.readAllowed=false;expect(await readDatasetImage(args)).toBeNull();expect(state.get).toHaveBeenCalledTimes(1);
  });
});
