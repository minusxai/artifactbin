/** Direct app pages and explicit raw responses keep distinct CSPs and the same ACL. */
import {describe,expect,it} from 'vitest';
import {candidateDocument,createAppServer,APP_CSP} from '@/server/app';
import {proxyRequest} from '@/server/__tests__/proxy-request';
import {createArtifact,updateSharing} from '@/lib/artifacts';
import {mintToken} from '@/lib/tokens';
import {createUser} from '@/lib/users';
import {mintExportKey} from '@/lib/export-key';
import {useAppHarness} from './harness';
useAppHarness();
const app=createAppServer({indexHtml:async()=>'<html><head></head><body><div id="root"></div></body></html>'});

it('recognizes only the canonical document address grammar',()=>{
  for(const path of ['/a/Ab3xK9','/@someone/Ab3xK9-title','/@someone/reports/2026/Ab3xK9-title'])expect(candidateDocument(path)).toEqual({id:'Ab3xK9'});
  for(const path of ['/a/not-an-id','/a/Ab3xK9/raw','/api/artifacts','/@someone','/'])expect(candidateDocument(path)).toBeNull();
});

describe('one direct document page',()=>{
  it.each(['public','unlisted','private'] as const)('keeps %s authorization independent from presentation',async visibility=>{
    const owner=await createUser({email:'mxmx_test_direct_owner@example.com'});
    const viewer=await createUser({email:'mxmx_test_direct_viewer@example.com'});
    const token=await mintToken('owner',owner.id);
    const row=await createArtifact(token.id,owner.id,{format:'markup',content:'',source:'<h1>direct proof</h1>',meta:{},title:'Document',description:null,visibility});
    await updateSharing(owner.id,row.id,{shares:[{email:viewer.email!,role:'viewer'}]});
    for(const actor of [{credential:'none' as const},{credential:'session' as const,userId:viewer.id,email:viewer.email}]){
      for(const suffix of ['','?intent=fork','?intent=comment','?intent=unknown']){
        const response=await proxyRequest(app,'/a/'+row.id+suffix,{headers:{accept:'text/html'}},actor);
        expect(response.status).toBe(visibility==='private'&&actor.credential==='none'?404:200);
        expect(response.headers.get('content-security-policy')).toBe(APP_CSP);
        const html=await response.text();expect(html).not.toMatch(/<iframe\b/);
        if(response.status===200){expect(html).toContain('mx-page-data');expect(html).toContain('direct proof');}
        else expect(html).not.toContain('direct proof');
      }
    }
    const raw=await proxyRequest(app,'/a/'+row.id+'/raw');
    expect(raw.status).toBe(visibility==='private'?404:200);
    if(raw.ok){expect(raw.headers.get('content-security-policy')).toContain('sandbox');expect(raw.headers.get('content-security-policy')).not.toBe(APP_CSP);}
  });
  it('validates capture credentials without query-presence authorization',async()=>{
    const owner=await createUser({email:'mxmx_test_capture_owner@example.com'}),token=await mintToken('owner',owner.id);
    const row=await createArtifact(token.id,owner.id,{format:'markup',content:'',source:'<h1>capture proof</h1>',meta:{},title:null,description:null,visibility:'private'});
    for(const key of ['',row.edit_id,'invalid',mintExportKey('Ab3xK9')])expect((await proxyRequest(app,'/a/'+row.id+'?key='+key)).status).toBe(404);
    const allowed=await proxyRequest(app,'/a/'+row.id+'?key='+mintExportKey(row.id));
    expect(allowed.status).toBe(200);expect(await allowed.text()).toContain('capture proof');
  });
});
