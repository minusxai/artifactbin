import { beforeEach,describe,expect,it,vi } from 'vitest';

const state=vi.hoisted(()=>({
  doc:{id:'doc123',edit_id:'edit123',format:'markup',deleted_at:null,user_id:'owner',token_id:'owner-token',source:'<Helmet />',meta:{},visibility:'private',link_role:null},
  dataset:{id:'data12',edit_id:'dataset-edit',format:'dataset',deleted_at:null,user_id:'owner',token_id:'owner-token',meta:{},visibility:'private',link_role:null,dataset_policy:{version:2,allow:[{actions:['insert','read'],from:{artifact:'doc123'}}]},policy_revision:1},
  declared:true,records:[] as Array<Record<string,any>>,readAllowed:true, put:vi.fn(), get:vi.fn(async()=>Buffer.from('optimized')),
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
vi.mock('@/lib/artifacts/dataflow',()=>({dataflowForRow:async()=>({flow:{imports:state.declared?[{name:'feedback',ref:'ref:data12'}]:[]}})}));
vi.mock('@/lib/artifacts/access',()=>({canReadArtifact:async()=>true}));
vi.mock('@/lib/datasets/catalog',()=>({catalogOf:(row:any)=>row.format==='dataset'?{kind:'stored'}:null}));
vi.mock('@/lib/datasets/policy/grants',()=>({grantsOf:(row:any)=>row.dataset_policy??null,grantContext:async()=>({caller:{userId:'reporter',tokenId:null},owner:{userId:'owner',tokenId:null},artifact:{id:'doc123',owner:{userId:'owner',tokenId:null}}}),grantsPermitRead:async()=>state.readAllowed,readThrough:async()=>state.readAllowed}));
vi.mock('@/lib/story/data/data-tiers',()=>({storeImageContent:async(bytes:Buffer,type:string)=>({format:'image',meta:{objectKey:'image/object',bytes:bytes.length,contentType:type}})}));
vi.mock('@/lib/object-store',()=>({objectKey:()=> 'file/object',objectStore:()=>({put:state.put,get:state.get})}));

import { readDatasetImage,readDatasetFile,uploadDatasetImage,uploadDatasetFile } from '../feedback-images';
vi.mock('@/lib/accounts',()=>({requestOrSessionActor:async()=>({viewer:{userId:'reporter',email:'reporter@example.test'},tokenId:null}),refusesCrossSite:()=>false}));
import { POST } from '@/app/a/[id]/datasets/[datasetId]/files/route';
import { GET } from '@/app/a/[id]/datasets/[datasetId]/files/[fileId]/route';
const actor={userId:'reporter',tokenId:null,email:'reporter@example.test'};
const upload=(bytes=Buffer.from('pixels'),datasetId='data12',editId='edit123')=>uploadDatasetImage({actor,documentId:'doc123',datasetId,editId,bytes,contentType:'image/png',operationKey:'retry-key-123'});

describe('dataset-bound feedback images',()=>{
  it('uploads an allowed text file with a common durable receipt and replay protection', async () => {
    const args = { actor, documentId:'doc123', datasetId:'data12', editId:'edit123', bytes:Buffer.from('hello'), contentType:'text/plain', filename:'note.txt', operationKey:'generic-retry-123' };
    const first = await uploadDatasetFile(args);
    expect(first).toMatchObject({ref:'dfile:abc234def456', name:'note.txt', contentType:'text/plain', size:5});
    expect(first.url).toContain('/a/doc123/datasets/data12/files/abc234def456');
    expect(await uploadDatasetFile(args)).toMatchObject({...first,replayed:true});
    expect(state.records).toHaveLength(1);
  });
  it.each([['report.pdf','application/pdf'],['data.csv','text/csv'],['archive.zip','application/zip']])('stores %s as an inert file with canonical content type',async(filename,contentType)=>{
    const result=await uploadDatasetFile({actor,documentId:'doc123',datasetId:'data12',editId:'edit123',bytes:Buffer.from('file'),contentType:'application/octet-stream',filename,operationKey:'file-key-123'});
    expect(result).toMatchObject({ref:'dfile:abc234def456',name:filename,contentType,size:4});
    expect(state.records[0]?.meta.format).toBe('file');
  });
  it('routes new image files through image sanitization and returns the common receipt',async()=>{
    const result=await uploadDatasetFile({actor,documentId:'doc123',datasetId:'data12',editId:'edit123',bytes:Buffer.from('pixels'),contentType:'application/octet-stream',filename:'photo.png',operationKey:'file-key-123'});
    expect(result).toMatchObject({ref:'dfile:abc234def456',name:'photo.png',contentType:'image/png'});
    expect(state.records[0]?.meta.format).toBe('image');
  });
  it('rejects active extensions, paths, empty bodies and mismatched replay filenames',async()=>{
    const args={actor,documentId:'doc123',datasetId:'data12',editId:'edit123',bytes:Buffer.from('file'),contentType:'text/plain',filename:'note.txt',operationKey:'file-key-123'};
    for(const filename of ['evil.html','../note.txt'])await expect(uploadDatasetFile({...args,filename})).rejects.toThrow();
    await expect(uploadDatasetFile({...args,bytes:Buffer.alloc(0)})).rejects.toThrow(/empty/);
    expect(state.put).not.toHaveBeenCalled();
    await uploadDatasetFile(args);
    await expect(uploadDatasetFile({...args,filename:'renamed.txt'})).rejects.toThrow(/already used/);
    const original=state.dataset.dataset_policy;
    try {
      state.dataset.dataset_policy={version:2,allow:[{actions:['read'],from:{artifact:'doc123'}}]};
      await expect(uploadDatasetFile(args)).rejects.toThrow(/insert grant/);
    } finally { state.dataset.dataset_policy=original; }
  });
  it('rejects undeclared datasets and advertised oversized request bodies',async()=>{
    state.declared=false;
    await expect(uploadDatasetFile({actor,documentId:'doc123',datasetId:'data12',editId:'edit123',bytes:Buffer.from('hello'),contentType:'text/plain',filename:'note.txt',operationKey:'undeclared-key-123'})).rejects.toThrow(/unavailable/);
    expect(state.put).not.toHaveBeenCalled();
    const request=new Request('http://localhost/a/doc123/datasets/data12/files',{method:'POST',headers:{'Content-Length':'1000000000000','X-Filename':'note.txt'},body:'hello'});
    expect((await POST(request,{params:Promise.resolve({id:'doc123',datasetId:'data12'})})).status).toBe(413);
  });
  it('rechecks insert grants after object storage before committing the receipt',async()=>{
    const original=state.dataset.dataset_policy;
    state.put.mockImplementationOnce(async()=>{state.dataset.dataset_policy={version:2,allow:[{actions:['read'],from:{artifact:'doc123'}}]};});
    try {
      await expect(uploadDatasetFile({actor,documentId:'doc123',datasetId:'data12',editId:'edit123',bytes:Buffer.from('hello'),contentType:'text/plain',filename:'note.txt',operationKey:'revoked-key-123'})).rejects.toThrow(/insert grant/);
      expect(state.records).toHaveLength(0);
    } finally {state.dataset.dataset_policy=original;}
  });
  it('runs upload and read handlers with current ACL and attachment safety headers',async()=>{
    const request=new Request('http://localhost/a/doc123/datasets/data12/files',{method:'POST',headers:{'X-Filename':encodeURIComponent('note.txt'),'X-Edit-Id':'edit123','Content-Type':'text/plain','Idempotency-Key':'route-key-123'},body:'hello'});
    const response=await POST(request,{params:Promise.resolve({id:'doc123',datasetId:'data12'})});
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ref:'dfile:abc234def456',size:5});
    const params={params:Promise.resolve({id:'doc123',datasetId:'data12',fileId:'abc234def456'})};
    const get=new Request('http://localhost/a/doc123/datasets/data12/files/abc234def456');
    const file=await GET(get,params);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toContain('attachment;');
    expect(file.headers.get('x-content-type-options')).toBe('nosniff');
    expect(file.headers.get('content-security-policy')).toContain('sandbox');
    state.readAllowed=false;
    expect((await GET(get,params)).status).toBe(404);
    expect(await readDatasetFile({actor,documentId:'doc123',datasetId:'data12',fileId:'abc234def456'})).toBeNull();
  });
  beforeEach(()=>{state.records.splice(0);state.declared=true;state.readAllowed=true;state.put.mockReset();state.get.mockClear();});
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
