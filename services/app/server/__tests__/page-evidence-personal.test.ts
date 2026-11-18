/** Real identity host, app handlers and storage: delegation keeps the actual human's current policy view. */
import {it,expect} from 'vitest';
import { storePolicy, revokeShares } from '@/__tests__/artifact-fixtures';
import {delegatedService,audiencesOf,noTokens} from '../../../auth/__tests__/helpers';
import {createAuthHost} from '@artifactbin/auth';
import {artifactReadKey,signArtifactReadGrant} from '@artifactbin/auth/identity/artifact-read-grants';
import {PAGE_EVIDENCE_PATH,CANONICAL_PAGE_EVIDENCE_PATH,SERVICE_AUTH_HEADER} from '@artifactbin/contracts';
import {createAppHost} from '@/server/host';
import {createGroup,removeGroupMember} from '@/lib/groups';
import {getDb} from '@/lib/platform';
import {admitGroupMember,mintAccountToken,useAppHarness} from '../../__tests__/harness';
import { dropShares, seedShares } from '@/__tests__/rows';
useAppHarness();
it('buffers human evidence and rechecks current app policy and identity parent without repeating row SQL',async()=>{
 const owner=await mintAccountToken('mxmx_test_evidence_owner'),viewer=await mintAccountToken('mxmx_test_evidence_reader');
 const group=await createGroup(owner.userId!,{handle:'human_evidence',name:'Evidence'}),host=await createAppHost(),db=await getDb();
 const human={credential:'bearer' as const,userId:owner.userId!,tokenId:owner.id};
 const create=async(body:unknown)=>{const r=await host.request(new Request('http://localhost/api/artifacts',{method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json'}}),human);expect(r.status,await r.clone().text()).toBe(201);return r.json();};
 const dataset=await create({title:'Metrics',dataset:[{name:'red',team:'red',secret:'secret-red'},{name:'blue',team:'blue',secret:'secret-blue'}],visibility:'private',destination:{type:'group',id:group.id}});
 const policy={version:3,tables:[{table:{schema:'public',name:'rows'},select_permissions:[{role:'viewer',permission:{columns:['name','team'],filter:{team:{_eq:'red'}}}}]}]};
 await storePolicy(dataset.id, policy);
 const page=await create({title:'Evidence',html:`<html><head><link rel="af-dataset" data-af-name="metrics" href="ref:${dataset.id}" data-af-mode="pinned" data-af-revision="1"></head><body>Evidence</body></html>`,visibility:'private',destination:{type:'group',id:group.id}});
 for(const id of [page.id,dataset.id])await seedShares(db, { artifact_id: id, user_id: null, email: viewer.email, role: 'viewer' });
 const service=delegatedService('reader','https://reader.example','synthetic-secret');
 let afterBuffer:(()=>Promise<unknown>)|undefined;const operations:unknown[]=[];
 const auth=createAuthHost({env:{IDENTITY__SERVICE_AUDIENCES:audiencesOf(service)},cookieSecret:'synthetic-cookie',tokens:noTokens,sessions:{resolve:async()=>null},identityDb:db,upstream:async(request,actor)=>{
  const input=await request.clone().json();operations.push(input);
  const response=await host.request(request,actor);
  if(!input.fingerprint&&afterBuffer){const body=await response.text();await afterBuffer();return new Response(body,{status:response.status});}
  return response;
 }});
 const grant=signArtifactReadGrant(artifactReadKey('synthetic-cookie'),service,{userId:viewer.userId!,parent:{kind:'token',id:viewer.id}}).token;
 const operation={kind:'page-evidence-sql',pageId:page.id,revision:'1',sql:'select name from metrics',params:{}};
 const call=(body:unknown={grant,operation},secret='synthetic-secret')=>auth.request(PAGE_EVIDENCE_PATH,{method:'POST',headers:{[SERVICE_AUTH_HEADER]:secret},body:JSON.stringify(body)});
 const result=await call();expect(result.status,await result.clone().text()).toBe(200);expect((await result.json()).rows).toEqual([{name:'red'}]);
 expect(operations).toHaveLength(2);expect(operations[0]).toEqual({operation});expect(operations[1]).toMatchObject({operation,fingerprint:expect.stringMatching(/^[a-f0-9]{64}$/)});
 expect((await db.query('SELECT user_id FROM artifact_shares WHERE artifact_id=ANY($1::text[])',[[page.id,dataset.id]])).rows.map(r=>r.user_id)).toEqual([null,null]);
 const schema=await call({grant,operation:{kind:'page-evidence-schema',pageId:page.id,revision:'1'}});expect(schema.status).toBe(200);expect(JSON.stringify(await schema.json())).not.toContain('secret');
 expect((await call(undefined,'wrong')).status).toBe(401);
 expect((await call({grant,operation,userId:owner.userId})).status).toBe(400);
 expect((await call({grant:grant+'x',operation})).status).toBe(401);
 const expired=signArtifactReadGrant(artifactReadKey('synthetic-cookie'),service,{userId:viewer.userId!,parent:{kind:'token',id:viewer.id}},Date.now()-3601000).token;expect((await call({grant:expired,operation})).status).toBe(401);
 const wrongService=signArtifactReadGrant(artifactReadKey('synthetic-cookie'),{...service,id:'other',origin:'https://other.example'},{userId:viewer.userId!,parent:{kind:'token',id:viewer.id}}).token;expect((await call({grant:wrongService,operation})).status).toBe(401);
 expect((await call({grant,operation:{...operation,kind:'artifact-read'}})).status).toBe(400);
 const direct=await auth.request(CANONICAL_PAGE_EVIDENCE_PATH,{method:'POST',body:JSON.stringify({operation})});expect(direct.status).toBe(404);
 // Only page readership remains: neither the arg_ grant nor the page link supplies dataset viewer authority.
 await revokeShares(dataset.id);expect((await call()).status).toBeGreaterThanOrEqual(400);
 await seedShares(db, { artifact_id: dataset.id, user_id: viewer.userId, email: viewer.email, role: 'viewer' });
 afterBuffer=()=>storePolicy(dataset.id, {version:3,tables:[]});
 const revoked=await call();expect(revoked.status).toBeGreaterThanOrEqual(400);expect(await revoked.text()).not.toContain('red');
 afterBuffer=undefined;await storePolicy(dataset.id, policy);
 afterBuffer=async()=>{await revokeShares(page.id);};expect((await call()).status).toBeGreaterThanOrEqual(400);
 afterBuffer=undefined;await seedShares(db, { artifact_id: page.id, user_id: viewer.userId, email: viewer.email, role: 'viewer' });
 const aborted=new AbortController();afterBuffer=async()=>{aborted.abort();await new Promise(()=>{});};
 const cancelled=await auth.request(PAGE_EVIDENCE_PATH,{method:'POST',signal:aborted.signal,headers:{[SERVICE_AUTH_HEADER]:'synthetic-secret'},body:JSON.stringify({grant,operation})});
 expect(cancelled.status).toBeGreaterThanOrEqual(400);expect(await cancelled.text()).not.toContain('red');afterBuffer=undefined;
 // Membership is re-decided during the metadata-only second admission too.
 await dropShares(db, [page.id, dataset.id]);
 await admitGroupMember(owner.userId!,group.id,viewer.userId!,'member');
 afterBuffer=async()=>{await removeGroupMember(owner.userId!,group.id,viewer.userId!);};
 expect((await call()).status).toBeGreaterThanOrEqual(400);
 afterBuffer=undefined;await admitGroupMember(owner.userId!,group.id,viewer.userId!,'member');
 afterBuffer=async()=>{const {revokeToken}=await import('@/lib/accounts');await revokeToken(viewer.id);};
 expect((await call()).status).toBe(401);
});
