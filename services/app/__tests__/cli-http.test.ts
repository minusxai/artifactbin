/**
 * The HTTP surface the CLI speaks to: conditional requests and ranges on the artifact routes, and
 * the unauthenticated capabilities document that pins the protocol and the authoring allowlists.
 */

import { it, expect, afterEach } from 'vitest';
import { DEFAULT_SOCIAL_PREVIEW_CROP } from '@/lib/story/social-preview';
import { fakeBrowser } from '@artifactbin/utils';
import { setServices } from '@/lib/services';
import { resetExportRenderer } from '@/lib/export';
import { request, useAppHarness } from './harness';
import { mintToken } from '@/lib/tokens';
import { POST as create } from '@/app/api/artifacts/route';
import { PUT as replace, GET as read } from '@/app/api/artifacts/[id]/route';
import { POST as revert } from '@/app/api/artifacts/[id]/revert/route';
import { GET as exportImage } from '@/app/api/artifacts/[id]/export/route';
import { CLI_PROTOCOL_VERSION } from '@artifactbin/contracts';
import { STORY_THEME_NAMES, STORY_TEMPLATE_NAMES } from '@/lib/validation/atlas-schemas';
import { JSX_STORY_COMPONENT_NAMES } from '@/lib/jsx/components';
import { GET } from '@/app/api/capabilities/route';

useAppHarness();

describe('cli-advanced-http', () => {
  afterEach(()=>setServices({}));
  it('revert returns the complete canonical head so the next write needs no read-back',async()=>{
   const token=await mintToken('cli-revert');const original=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Original</p>',title:'Doc'}}))).json();
   const params={params:Promise.resolve({id:original.id})},path=`/api/artifacts/${original.id}`;
   const updated=await(await replace(request(path,{method:'PUT',token:token.token,json:{markup:'<p>Changed</p>',expectedVersion:original.version,expectedState:original.state}}),params)).json();
   const restored=await revert(request(path+'/revert',{method:'POST',token:token.token,json:{version:original.version,expectedVersion:updated.version,expectedState:updated.state}}),params);
   expect(restored.status).toBe(200);const body=await restored.json();
   const canonical=await(await read(request(path,{token:token.token}),params)).json();
   for(const key of ['id','version','edit_id','state','markup','title','theme','template','visibility'])expect(body[key],key).toEqual(canonical[key]);
   expect(body.state).toMatch(/^[a-f0-9]{64}$/);
  });
  it('authenticated export forwards card mode and refuses an unknown mode',async()=>{
   await resetExportRenderer();const browser=fakeBrowser();setServices({browser});
   const token=await mintToken('cli-export');const doc=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<h1>Card</h1>'}}))).json();
   const params={params:Promise.resolve({id:doc.id})};
   const invalid=await exportImage(request(`/api/artifacts/${doc.id}/export?mode=wrong`,{token:token.token}),params);expect(invalid.status).toBe(400);
   const result=await exportImage(request(`/api/artifacts/${doc.id}/export?mode=card`,{token:token.token}),params);expect(result.status).toBe(200);
   expect((browser as unknown as {calls:Array<{capture:string}>}).calls.at(-1)?.capture).toEqual({card:DEFAULT_SOCIAL_PREVIEW_CROP});
  });
});

describe('cli-capabilities', () => {
  it('advertises versioned authoring names and the write contract without authentication or database access',async()=>{
   const response=await GET(request('/api/capabilities'));expect(response.status).toBe(200);
   const body=await response.json();expect(body.protocol).toBe(CLI_PROTOCOL_VERSION);expect(body.allowlists.version).toBe(CLI_PROTOCOL_VERSION);
   expect(body.allowlists.themes).toEqual(STORY_THEME_NAMES);expect(body.allowlists.templates).toEqual(STORY_TEMPLATE_NAMES);expect(body.allowlists.components).toEqual(JSX_STORY_COMPONENT_NAMES);
   expect(body.reference).toBe('ref:<id>');
  });
});
