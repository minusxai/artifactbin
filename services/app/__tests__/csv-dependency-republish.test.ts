/**
 * A CSV A PAGE LINKS BY PATH, written to after publish (a scheduled function, the page SQL door), then the page is
 * edited: republishing with the CSV UNCHANGED keeps the dataset as it is now (no re-import over the newer rows, no
 * conflict); a CHANGED CSV keeps the rule for replacing data (a conditional PUT): a conditional replace of
 * the version the publish saw, refused when a newer version exists, and nothing is overwritten.
 */
import {expect,it} from 'vitest';
import {identityForUser} from '@/lib/accounts';
import {createHash} from 'node:crypto';
import {artifactState,getArtifactById,setMetadataFor} from '@/lib/artifacts';
import {loadDatasetRows} from '@/lib/datasets';
import {POST as create} from '@/app/api/artifacts/route';
import {PUT as update} from '@/app/api/artifacts/[id]/route';
import {POST as sqlPost} from '@/app/api/artifacts/[id]/sql/route';
import {mintAccountToken,request,useAppHarness} from './harness';

useAppHarness();
const CSV='title,source\nseed,manual\n';
const html=(body:string)=>`<html><head><link rel="af-dataset" data-af-name="items" href="./items.csv"></head><body>${body}</body></html>`;
const bundle=(csv:string,mappings?:Record<string,unknown>)=>({entryPath:'index.html',files:[{path:'items.csv',contentType:'text/csv',base64:Buffer.from(csv).toString('base64')}],...(mappings?{mappings}:{})});
const params=(id:string)=>({params:Promise.resolve({id})});
let keys=0;const key=()=>`csv_republish_${String(++keys).padStart(8,'0')}_key`;

async function published(){
 const owner=await mintAccountToken('mxmx_test_csv_republish');
 const response=await create(request('/api/artifacts',{method:'POST',token:owner.token,headers:{'Idempotency-Key':key()},json:{html:html('<p>v1</p>'),visibility:'unlisted',publicationBundle:bundle(CSV)}}));
 const saved=await response.json() as {id:string;dependencyReceipts:Array<{path:string;kind:'dataset';id:string;revision:string;state?:string;sha256:string}>};
 expect(response.status,JSON.stringify(saved)).toBe(201);
 const receipt=saved.dependencyReceipts.find(r=>r.path==='items.csv')!;
 // A write after publish, as a reader's sql makes: it moves the dataset's head.
 const wrote=await sqlPost(request(`/api/artifacts/${saved.id}/sql`,{method:'POST',token:owner.token,json:{sql:"insert into items (title, source) values ('from schedule', 'schedule')",revision:'1'}}),params(saved.id));
 expect(wrote.status,await wrote.clone().text()).toBe(200);
 expect((await getArtifactById(receipt.id))!.version).toBeGreaterThan(Number(receipt.revision));
 const {path:_path,...mapping}=receipt;
 return {owner,page:saved.id,dataset:receipt.id,mapping};
}
const rows=async(id:string)=>(await loadDatasetRows((await getArtifactById(id))!)).map(row=>`${row.title}|${row.source}`).sort();
async function republish(w:Awaited<ReturnType<typeof published>>,csv:string,body:string){
 const head=(await getArtifactById(w.page))!;
 return update(request(`/api/artifacts/${w.page}`,{method:'PUT',token:w.owner.token,headers:{'Idempotency-Key':key()},json:{expectedVersion:head.version,expectedState:artifactState(head),html:html(body),publicationBundle:bundle(csv,{'items.csv':w.mapping})}}),params(w.page));
}

it('republishing the page with its CSV unchanged keeps the dataset as it is, newer rows included',async()=>{
 const w=await published();
 expect(w.mapping.sha256).toBe(createHash('sha256').update(CSV).digest('hex'));
 const before=await rows(w.dataset),datasetVersion=(await getArtifactById(w.dataset))!.version;
 const response=await republish(w,CSV,'<p>v2: the page text changed</p>');
 const body=await response.text();
 expect(response.status,body).toBe(200);
 expect(before).toEqual(['from schedule|schedule','seed|manual']);
 expect(await rows(w.dataset)).toEqual(before);
 // Nothing was re-imported: the dataset's head is the one the write made.
 expect((await getArtifactById(w.dataset))!.version).toBe(datasetVersion);
 expect((await getArtifactById(w.page))!.source).toContain('v2: the page text changed');
 expect(body).toContain(`ref:${w.dataset}`);
 // And again: the recorded mapping still reuses it.
 expect((await republish(w,CSV,'<p>v3</p>')).status).toBe(200);
 expect(await rows(w.dataset)).toEqual(before);
});

it('a changed CSV keeps the replace rule: a newer dataset version refuses it, and nothing is overwritten',async()=>{
 const w=await published();
 const before=await rows(w.dataset);
 const response=await republish(w,'title,source\nreplaced,csv\n','<p>v2</p>');
 expect(response.status).toBe(409);
 expect(await response.text()).toMatch(/conflict/i);
 expect(await rows(w.dataset)).toEqual(before);
 expect((await getArtifactById(w.page))!.source).toContain('v1');
});

// JSON dependencies are user-visible datasets too: their real file name is their initial title.
it('names a JSON dataset dependency from its source file and preserves an existing title on republish',async()=>{
 const owner=await mintAccountToken('mxmx_test_json_dependency_title');
 const file={path:'data/monthly-summary.json',contentType:'application/json',base64:Buffer.from(JSON.stringify({kind:'stored',tables:[{schema:'public',name:'rows',rows:[{month:'June',total:12}]}]})).toString('base64')};
 const markup='<html><head><title>Summary</title><link rel="af-dataset" data-af-name="summary" href="./data/monthly-summary.json"></head><body>Summary</body></html>';
 const response=await create(request('/api/artifacts',{method:'POST',token:owner.token,headers:{'Idempotency-Key':key()},json:{html:markup,publicationBundle:{entryPath:'index.html',files:[file]}}}));
 const saved=await response.json();expect(response.status,JSON.stringify(saved)).toBe(201);
 const dependency=saved.dependencyReceipts.find((r:{path:string})=>r.path===file.path);
 expect((await getArtifactById(dependency.id))?.title).toBe('monthly-summary.json');
 await setMetadataFor(identityForUser(owner.userId,owner.id),dependency.id,{title:'Monthly totals'});
 const {path:_path,...mapping}=dependency;
 const head=(await getArtifactById(saved.id))!;
 const replaced=await update(request(`/api/artifacts/${saved.id}`,{method:'PUT',token:owner.token,headers:{'Idempotency-Key':key()},json:{expectedVersion:head.version,expectedState:artifactState(head),html:markup,publicationBundle:{entryPath:'index.html',files:[file],mappings:{[file.path]:mapping}}}}),params(saved.id));
 expect(replaced.status,await replaced.clone().text()).toBe(200);
 expect((await getArtifactById(dependency.id))?.title).toBe('Monthly totals');
});
