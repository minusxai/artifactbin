/**
 * Delete protection for media a page uses directly: an image, a PDF or a file named by a page's own markup
 * (img src, video poster, a href, the install icon) has that page as a dependent, so a delete preflight
 * answers has_dependents rather than letting it go silently. Text that merely mentions the reference does not count.
 */
import {describe,expect,it} from 'vitest';
import {samplePdfDataUrl} from '../../../scripts/lib/sample-pdf.mjs';
import {mintAccountToken,useAppHarness} from './harness';
import {identityForUser,type TokenHoldingActor} from '@/lib/accounts';
import {getArtifactById} from '@/lib/artifacts';
import {createArtifactFromBody,preflightPublication} from '@/lib/publish';

useAppHarness();
const BASE='http://localhost:3030';
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAASUlEQVRYhe2WAQkAQAwCF8dMpruoH2PPOFgAET03KV/drCuIgtChmqHYMtbxE8GIDtUMxZaxDqH4oKFDNUOxZcghBGOdjhwe1weeF8xbShDdKgAAAABJRU5ErkJggg==';
const page=(title:string,head:string,body:string)=>
 `<!doctype html><html><head><title>${title}</title>${head}</head><body><h1>${title}</h1>${body}</body></html>`;
async function actor(name:string):Promise<TokenHoldingActor>{const token=await mintAccountToken(name);return identityForUser(token.userId,token.id);}
async function created(owner:TokenHoldingActor,body:Record<string,unknown>):Promise<string>{
 const response=await createArtifactFromBody(body,owner,BASE,new Request(`${BASE}/api/artifacts`,{method:'POST'}));
 expect(response.status,await response.clone().text()).toBe(201);
 return ((await response.json()) as {id:string}).id;
}
const media={
 image:{image:PNG},
 pdf:{pdf:samplePdfDataUrl(1)},
 file:{file:{filename:'notes.txt',contentType:'text/plain',base64:Buffer.from('plain notes').toString('base64')}},
};
const deletePreflight=async(owner:TokenHoldingActor,id:string)=>{
 const response=await preflightPublication(new Request(`${BASE}/api/preflight`),owner,{id,mode:'delete',input:{}});
 return {status:response.status,body:await response.json() as {error?:string;dependents?:{id:string}[]}};
};

describe('media a page uses directly',()=>{
 it.each([
  ['image','img src',(ref:string)=>['',`<img src="${ref}" alt="Dot">`]],
  ['image','video poster',(ref:string)=>['',`<video poster="${ref}"></video>`]],
  ['image','install icon',(ref:string)=>[`<meta name="artifactbin:pwa-icon" content="${ref}">`,'<p>Installable</p>']],
  ['pdf','a href',(ref:string)=>['',`<p><a href="${ref}">The brief</a></p>`]],
  ['file','a href',(ref:string)=>['',`<p><a href="${ref}">The notes</a></p>`]],
 ] as const)('a %s named by %s is a dependent of the page',async(kind,_how,markup)=>{
  const owner=await actor(`media_dependents_${kind}`);
  const id=await created(owner,media[kind]);
  expect((await getArtifactById(id))?.format).toBe(kind);
  const [head,body]=markup(`ref:${id}`);
  const user=await created(owner,{html:page('Uses it',head,body)});
  await created(owner,{html:page('Mentions it','',`<p>See ref:${id} in the text.</p>`)});
  const refused=await deletePreflight(owner,id);
  expect(refused.status).toBe(409);
  expect(refused.body.error).toBe('has_dependents');
  expect(refused.body.dependents?.map(row=>row.id)).toEqual([user]);
 });

 it('a media artifact no page uses has no dependents',async()=>{
  const owner=await actor('media_dependents_unused');
  const id=await created(owner,media.pdf);
  await created(owner,{html:page('Other','','<p>Nothing here</p>')});
  expect(await deletePreflight(owner,id)).toMatchObject({status:200,body:{dependents:[]}});
 });
});
