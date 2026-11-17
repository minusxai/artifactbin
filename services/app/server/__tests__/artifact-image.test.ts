/**
 * The delegated image seam on real handlers and storage, the browser stubbed at the registered service as the
 * exporter's tests do: the read seam's current decision, the reader's own audience, element and slide captures, the
 * fit, and, composed behind the real identity host, the recheck after rendering.
 */
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {afterEach,beforeAll,describe,expect,it} from 'vitest';
import {attachActor} from '@artifactbin/utils';
import {createAuthHost} from '@artifactbin/auth';
import {artifactReadKey,signArtifactReadGrant} from '@artifactbin/auth/identity/artifact-read-grants';
import {ARTIFACT_IMAGE_BYTES,ARTIFACT_IMAGE_PATH,CANONICAL_ARTIFACT_IMAGE_PATH,SERVICE_AUTH_HEADER,type RenderRequest} from '@artifactbin/contracts';
import {mintAccountToken,useAppHarness} from '@/__tests__/harness';
import {account,mine} from '@/__tests__/artifact-fixtures';
import {getDb,setServices} from '@/lib/platform';
import {updateSharingFor} from '@/lib/artifacts';
import {exportKeyReader,resetExportRenderer} from '@/lib/export';
import {createAppServer} from '../app';
import {createAppHost} from '../host';
useAppHarness();

let PNG:Buffer;
beforeAll(async()=>{
 // A page-sized capture far past the budget: flat bands and one noisy channel.
 const width=1200,height=1600,raw=Buffer.alloc(width*height*3);let seed=3;
 for(let i=0;i<raw.length;i+=3){seed=(seed*1103515245+12345)&0x7fffffff;const y=Math.floor(i/3/width);raw[i]=Math.floor(y/40)%6*40;raw[i+1]=200;raw[i+2]=seed>>>16&255;}
 PNG=await sharp(raw,{raw:{width,height,channels:3}}).png().toBuffer();
});
type Verdict=Awaited<ReturnType<NonNullable<Parameters<typeof setServices>[0]['browser']>['render']>>;
function browser(answer:(request:RenderRequest)=>Verdict|Promise<Verdict>){
 const requests:RenderRequest[]=[];
 setServices({browser:{render:async request=>{requests.push(request);return answer(request);}}});
 return requests;
}
afterEach(async()=>{await resetExportRenderer();setServices({});});
const app=()=>createAppServer({indexHtml:async()=>'<html></html>'});
function seam(server:ReturnType<typeof app>,userId:string,body:Record<string,unknown>,actor:Record<string,unknown>={}){
 const request=new Request('http://localhost'+CANONICAL_ARTIFACT_IMAGE_PATH,{method:'POST',body:JSON.stringify(body)});
 attachActor(request,{credential:'session',userId,...actor} as Parameters<typeof attachActor>[1]);
 return server.fetch(request);
}

describe('the canonical image seam',()=>{
 it('renders as the person who may read it now, fitted under the budget in the asked format',async()=>{
  const owner=await account('owner@example.test'),reader=await account('reader@example.test'),stranger=await account('stranger@example.test');
  const row=await mine(owner,'Private'),server=app();
  const requests=browser(()=>({ok:true,mime:'image/png',bytes:PNG}));
  // Absent and inaccessible alike: 404, and nothing rendered.
  for(const [who,id] of [[stranger.userId,row.id],[reader.userId,row.id],[owner.userId,'missing1']] as const){
   const refused=await seam(server,who,{artifact_id:id});
   expect([refused.status,await refused.json()]).toEqual([404,{error:'not_found'}]);
  }
  expect(requests).toEqual([]);
  await updateSharingFor(owner,row.id,{shares:[{email:'reader@example.test',role:'viewer'}]});
  const response=await seam(server,reader.userId,{artifact_id:row.id});
  expect(response.status,await response.clone().text()).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const image=await response.json();
  expect(image).toMatchObject({id:row.id,version:row.version,format:'png',mime:'image/png'});
  const bytes=Buffer.from(image.data,'base64');
  expect(bytes.length).toBe(image.bytes);
  expect(image.bytes).toBeLessThanOrEqual(ARTIFACT_IMAGE_BYTES);
  expect(PNG.length).toBeGreaterThan(ARTIFACT_IMAGE_BYTES);
  const meta=await sharp(bytes).metadata();
  expect([meta.format,meta.width,meta.height]).toEqual(['png',image.width,image.height]);
  expect(image.width).toBeGreaterThanOrEqual(320);
  // The capture read the private page as this reader, by a key naming them, inside the delegated deadline.
  expect(requests).toHaveLength(1);
  const url=new URL(requests[0]!.url);
  expect(url.pathname).toBe(`/a/${row.id}/raw`);
  expect(exportKeyReader(row.id,url.searchParams.get('key')!)).toMatchObject({userId:reader.userId});
  expect(requests[0]!.timeoutMs).toBeLessThanOrEqual(18_000);
  // The stored render is this reader's: revoking their share refuses them, though the image is still stored.
  await updateSharingFor(owner,row.id,{shares:[]});
  expect((await seam(server,reader.userId,{artifact_id:row.id})).status).toBe(404);
  expect(requests).toHaveLength(1);
  // The owner's render is their own, never the reader's stored one.
  expect((await seam(server,owner.userId,{artifact_id:row.id})).status).toBe(200);
  expect(requests).toHaveLength(2);
  expect(exportKeyReader(row.id,new URL(requests[1]!.url).searchParams.get('key')!)).toMatchObject({userId:owner.userId});
 });

 it('captures one element or slide as JPEG, and keeps the export door\'s refusals and their details',async()=>{
  const owner=await account('jpeg-owner@example.test'),row=await mine(owner,'Charts'),server=app();
  const jpeg=await sharp(PNG).jpeg({quality:95}).toBuffer();
  const requests=browser(request=>typeof request.capture==='object'&&'element' in request.capture&&request.capture.element==='#missing'
   ?{ok:false,reason:'no_element',why:'none'}:{ok:true,mime:'image/jpeg',bytes:jpeg,element:true});
  const response=await seam(server,owner.userId,{artifact_id:row.id,format:'jpg',element:'#orders-chart',slide:2});
  expect(response.status,await response.clone().text()).toBe(200);
  const image=await response.json();
  expect(image).toMatchObject({format:'jpg',mime:'image/jpeg'});
  expect(image.bytes).toBeLessThanOrEqual(ARTIFACT_IMAGE_BYTES);
  expect((await sharp(Buffer.from(image.data,'base64')).metadata()).format).toBe('jpeg');
  expect(requests[0]).toMatchObject({format:'jpg',selector:'body',capture:{element:'#orders-chart',slide:2}});
  const missing=await seam(server,owner.userId,{artifact_id:row.id,element:'#missing'});
  expect(missing.status).toBe(404);
  expect(await missing.json()).toMatchObject({error:'element_not_found',element:'#missing',found:'none'});
  for(const body of [{artifact_id:row.id,format:'gif'},{artifact_id:row.id,element:'<script>'}]){
   const refused=await seam(server,owner.userId,body);
   expect(refused.status,JSON.stringify(body)).toBe(400);
  }
  for(const body of [{artifact_id:row.id,mode:'card'},{artifact_id:row.id,refresh:'1'},{artifact_id:row.id,slide:0},{artifact_id:row.id,slide:'2'}])
   expect((await seam(server,owner.userId,body)).status,JSON.stringify(body)).toBe(400);
  // Only the identity owner's verified human session: never a token, a session cookie's actor or nobody.
  expect((await seam(server,owner.userId,{artifact_id:row.id},{tokenId:'tok_1'})).status).toBe(403);
  expect((await seam(server,owner.userId,{artifact_id:row.id},{credential:'bearer'})).status).toBe(403);
 });

 it('refuses an image still over the budget at its narrowest as too_large, with a hint',async()=>{
  const owner=await account('tall-owner@example.test'),row=await mine(owner,'Tall'),server=app();
  const width=400,height=8000,raw=Buffer.alloc(width*height*3);let seed=5;
  for(let i=0;i<raw.length;i++){seed=(seed*1103515245+12345)&0x7fffffff;raw[i]=seed>>>16&255;}
  const noise=await sharp(raw,{raw:{width,height,channels:3}}).png().toBuffer();
  browser(()=>({ok:true,mime:'image/png',bytes:noise}));
  const response=await seam(server,owner.userId,{artifact_id:row.id});
  expect(response.status).toBe(413);
  const told=await response.json();
  expect(told).toMatchObject({error:'too_large',width:320,max:ARTIFACT_IMAGE_BYTES});
  expect(told.hint).toMatch(/element or slide, or jpg/);
 });
});

describe('behind the identity host',()=>{
 it('delivers a reader\'s image, and nothing once their access is gone after the render',async()=>{
  const owner=await account('relay-owner@example.test'),reader=await mintAccountToken('mxmx_test_relay_reader');
  const row=await mine(owner,'Relayed'),host=await createAppHost(),db=await getDb();
  await updateSharingFor(owner,row.id,{shares:[{email:reader.email!,role:'viewer'}]});
  const requests=browser(()=>({ok:true,mime:'image/png',bytes:PNG}));
  const service={id:'relay',origin:'https://relay.example',introspectionSecretSha256:createHash('sha256').update('synthetic-secret').digest('hex')};
  let afterImage:(()=>Promise<unknown>)|undefined;
  const auth=createAuthHost({env:{IDENTITY__SERVICE_AUDIENCES:JSON.stringify([{id:service.id,origin:service.origin,introspection_secret_sha256:service.introspectionSecretSha256,artifact_reads:true}])},
   cookieSecret:'synthetic-cookie',tokens:{byToken:async()=>null},sessions:{resolve:async()=>null},identityDb:db,upstream:async(request,actor)=>{
    const response=await host.request(request,actor);
    if(new URL(request.url).pathname===CANONICAL_ARTIFACT_IMAGE_PATH&&afterImage){const body=await response.text();await afterImage();return new Response(body,{status:response.status,headers:response.headers});}
    return response;
   }});
  const grant=signArtifactReadGrant(artifactReadKey('synthetic-cookie'),service,{userId:reader.userId!,parent:{kind:'token',id:reader.id}}).token;
  const call=(body:Record<string,unknown>)=>auth.request(ARTIFACT_IMAGE_PATH,{method:'POST',headers:{[SERVICE_AUTH_HEADER]:'synthetic-secret'},body:JSON.stringify(body)});
  const response=await call({grant,artifact_id:row.id,element:'#chart'});
  expect(response.status,await response.clone().text()).toBe(503);
  // An element capture from a browser that predates element capture is refused, never the whole page: as the door says.
  expect(await response.json()).toEqual({error:'render_unavailable'});
  await resetExportRenderer();await db.query('UPDATE export_image_cache SET retry_after=NULL');
  browser(()=>({ok:true,mime:'image/png',bytes:PNG,element:true}));
  const delivered=await call({grant,artifact_id:row.id,element:'#chart'});
  expect(delivered.status,await delivered.clone().text()).toBe(200);
  const image=await delivered.json();
  expect(image).toMatchObject({id:row.id,format:'png'});
  expect(image.bytes).toBeLessThanOrEqual(ARTIFACT_IMAGE_BYTES);
  expect(JSON.stringify(image).length).toBeLessThan(200*1024);
  expect(requests.length).toBeGreaterThan(0);
  // The share is revoked between the render and delivery: the read seam's second decision refuses it.
  afterImage=()=>updateSharingFor(owner,row.id,{shares:[]});
  const revoked=await call({grant,artifact_id:row.id,element:'#chart'});
  expect(revoked.status).toBe(404);
  expect(await revoked.text()).not.toContain('"data"');
  afterImage=undefined;
  // The seam itself is never reachable from outside: the identity host's internal-path refusal answers.
  expect((await auth.request(CANONICAL_ARTIFACT_IMAGE_PATH,{method:'POST',body:JSON.stringify({artifact_id:row.id})})).status).toBe(404);
 });
});
