import {nativeSource} from './native-publication-fixture';
import {restoreDocument} from './prepared-document';
import {observedRequest} from './conditional-request';
/**
 * The HTTP surface the CLI speaks to: conditional requests and ranges on the artifact routes, and
 * the unauthenticated capabilities document that pins the protocol and the authoring allowlists.
 */

import { it, expect, afterEach } from 'vitest';
import { DEFAULT_SOCIAL_PREVIEW_CROP } from '@/lib/document/social-preview';
import { fakeBrowser } from '@artifactbin/utils';
import { setServices } from '@/lib/platform';
import { resetExportRenderer } from '@/lib/export';
import { request, useAppHarness } from './harness';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { POST as create } from '@/app/api/artifacts/route';
import { PUT as replace, GET as read } from '@/app/api/artifacts/[id]/route';
import { GET as exportImage } from '@/app/api/artifacts/[id]/export/route';
import { GET } from '@/app/api/capabilities/route';

useAppHarness();

describe('cli-advanced-http', () => {
  afterEach(()=>setServices({}));
  it('revert returns the complete canonical head so the next write needs no read-back',async()=>{
   const token=await mintToken('cli-revert');const original=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{html:nativeSource('<p>Original</p>'),title:'Doc'}}))).json();
   const params={params:Promise.resolve({id:original.id})},path=`/api/artifacts/${original.id}`;
   const updated=await(await replace(await observedRequest(path,{method:'PUT',token:token.token,json:{html:nativeSource('<p>Changed</p>'),expectedVersion:original.version,expectedState:original.state}}),params)).json();
   expect(updated.version).toBe(original.version+1);
   const restored=await restoreDocument(token.token,original.id,original.version);
   expect(restored.status).toBe(200);const body=await restored.json();
   const canonical=await(await read(request(path,{token:token.token}),params)).json();
   for(const key of ['id','version','edit_id','state','markup','title','theme','template','visibility'])expect(body[key],key).toEqual(canonical[key]);
   expect(body.state).toMatch(/^[a-f0-9]{64}$/);
  });
  it('authenticated export forwards card mode and refuses an unknown mode',async()=>{
   await resetExportRenderer();const browser=fakeBrowser();setServices({browser});
   const token=await mintToken('cli-export');const doc=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{html:nativeSource('<h1>Card</h1>')}}))).json();
   const params={params:Promise.resolve({id:doc.id})};
   const invalid=await exportImage(request(`/api/artifacts/${doc.id}/export?mode=wrong`,{token:token.token}),params);expect(invalid.status).toBe(400);
   const result=await exportImage(request(`/api/artifacts/${doc.id}/export?mode=card`,{token:token.token}),params);expect(result.status).toBe(200);
   expect((browser as unknown as {calls:Array<{capture:string}>}).calls.at(-1)?.capture).toEqual({card:DEFAULT_SOCIAL_PREVIEW_CROP});
  });
});

describe('cli-capabilities', () => {
  it('advertises factual native publication, GraphQL and one author skill without authentication',async()=>{
   const response=await GET(request('/api/capabilities'));expect(response.status).toBe(200);
   const body=await response.json();expect(body.version).toBe(1);
   expect(body.page).toEqual({format:'html',create:{method:'POST',path:'/api/artifacts'},update:{method:'PUT',path:'/api/artifacts/{id}',required:['html','expectedVersion','expectedState']}});
   expect(body.graphql).toEqual({method:'POST',path:'/api/artifacts/{id}/graphql',schema:{method:'GET',path:'/api/artifacts/{id}/graphql'}});
   expect(body.dataset).toEqual({createField:'dataset',linkRel:'af-dataset',namespaceAttribute:'data-af-name',modes:['live','pinned']});
   expect(body.skill).toEqual({name:'artifactbin',archive:'/skills/artifactbin.zip',guide:'/llms.txt'});
   expect(body.reference).toBe('ref:<id>');expect(body).not.toHaveProperty('allowlists');expect(body).not.toHaveProperty('protocol');
  });
});
