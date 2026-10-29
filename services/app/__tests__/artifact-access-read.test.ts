import {expect,it} from 'vitest';
import {useAppHarness} from './harness';
import { createUser } from '@/lib/accounts';
import { ANONYMOUS_ACTOR } from '@/lib/accounts';
import {canReadArtifact,getArtifactAccessById,getArtifactById} from '@/lib/artifacts';
import {getDb} from '@/lib/platform';
const harness=useAppHarness();
/** THE ACCESS ROW — only the columns a read decision consults, so a hot path (presence, a stream's re-authorization) never ships a document. */
it('reads the access columns of the same live row, and decides read access exactly as the whole row does',async()=>{
 const owner=await createUser({email:'mxmx_test_access_read@example.com'}),stranger=await createUser({email:'mxmx_test_access_read_other@example.com'});
 const db=await harness.db();
 await db.query("INSERT INTO artifacts(id,token_id,user_id,format,visibility,version,link_role) VALUES ('accpub','tok_acc',$1,'html','public',3,'viewer'),('accpriv','tok_acc',$1,'html','private',1,NULL),('accunl','tok_acc',$1,'html','unlisted',2,'editor')",[owner.id]);
 const actors=[ANONYMOUS_ACTOR,{credential:'session' as const,userId:owner.id,tokenId:null,email:owner.email,emailVerified:true},{credential:'session' as const,userId:stranger.id,tokenId:null,email:stranger.email,emailVerified:true}];
 for(const id of ['accpub','accpriv','accunl']){
  const access=await getArtifactAccessById(id),whole=await getArtifactById(id);
  expect(access).not.toBeNull();
  expect(Object.keys(access!).sort()).toEqual(['format','group_id','id','link_role','token_id','user_id','version','visibility']);
  for(const key of Object.keys(access!) as (keyof typeof access & string)[])expect(access![key as keyof typeof access]).toEqual(whole![key as keyof typeof whole]);
  for(const actor of actors)expect(await canReadArtifact(access!,actor as never)).toBe(await canReadArtifact(whole!,actor as never));
 }
 await (await getDb()).query("UPDATE artifacts SET deleted_at=now() WHERE id='accpub'");
 expect(await getArtifactAccessById('accpub')).toBeNull();
 expect(await getArtifactAccessById('missing')).toBeNull();
});
