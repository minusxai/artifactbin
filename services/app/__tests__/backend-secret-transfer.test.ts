import {it,expect,vi} from 'vitest';
import {request,useAppHarness,mintAccountToken} from './harness';
import {POST} from '@/app/api/artifacts/route';
import {readHtmlPage} from '@/lib/html-publication';
import {getHtmlBackendVersion} from '@/lib/html-backends';
import { identityForUser } from '@/lib/accounts';
import {backendSecrets,readPinnedBackendSecret} from '@/lib/html-backend-secrets';
import {transferArtifact} from '@/lib/artifacts';
vi.mock('@/lib/page-operations',async original=>({...await original<typeof import('@/lib/page-operations')>(),compilePageBackend:async(source:string)=>({typeDefs:'type Query { ready: Boolean }',compiled:source,secretBindings:['TOKEN'],secretHosts:{TOKEN:'api.example.com'}})}));
const harness=useAppHarness();
it('revokes immutable former-owner secret access on transfer while preserving code',async()=>{
 const owner=await mintAccountToken('credential-owner'),next=await mintAccountToken('new-owner');const db=await harness.db();
 const created=await(await POST(request('/api/artifacts',{method:'POST',token:owner.token,json:{html:'<html><head><link rel="af-resolver" data-af-name="db" href="./db.ts"></head><body>Ready</body></html>',resolverSources:{db:'immutable-code'}}}))).json();
 const actor=identityForUser(owner.userId,owner.id),page=await readHtmlPage(actor,created.id),link=page.links[0];if(link.kind!=='backend')throw Error('missing backend');
 const backend=(await getHtmlBackendVersion(link.backendId,link.version))!;
 await backendSecrets.put({ownerId:owner.userId!,backendId:backend.backendId},'TOKEN','former-owner-secret');
 // The host reads the pinned value for caps.fetch placeholders; resolver code never receives it.
 expect(await readPinnedBackendSecret(backend,'TOKEN')).toBe('former-owner-secret');
 await db.query("INSERT INTO groups(id,handle,name,created_by) VALUES('secret_transfer','secret_transfer','Transfer',$1)",[owner.userId]);
 for(const user of [owner,next])await db.query("INSERT INTO group_members(group_id,user_id,role) VALUES('secret_transfer',$1,'editor')",[user.userId]);
 expect(await transferArtifact(actor,page.pageId,{type:'group',id:'secret_transfer'})).not.toBeNull();
 await expect(readPinnedBackendSecret(backend,'TOKEN')).rejects.toThrow('unavailable');
 expect(await transferArtifact(identityForUser(next.userId,next.id),page.pageId,{type:'personal'})).not.toBeNull();
 await expect(readPinnedBackendSecret(backend,'TOKEN')).rejects.toThrow('unavailable');
 expect((await getHtmlBackendVersion(link.backendId,link.version))?.ownerId).toBe(owner.userId);
});
