/** The delegated app seam uses current canonical ACL and strips author authority. */
import {describe,it,expect} from 'vitest';
import {attachActor} from '@artifactbin/utils';
import {CANONICAL_ARTIFACT_READ_PATH} from '@artifactbin/contracts';
import {useAppHarness,admitGroupMember} from '@/__tests__/harness';
import {account,mine,sql} from '@/__tests__/artifact-fixtures';
import {createGroup,removeGroupMember} from '@/lib/groups';
import {updateSharingFor,setArtifactGroupShare,getArtifactById} from '@/lib/artifacts';
import {createAppServer} from '../app';
useAppHarness();
describe('canonical delegated read',()=>{
 it('reads owned and shared private source, refuses strangers and revocation, never checkpoints',async()=>{
  const owner=await account('owner@example.test'),reader=await account('reader@example.test');
  const row=await mine(owner,'Private');const app=createAppServer({indexHtml:async()=>'<html></html>'});
  const read=(userId:string,id=row.id)=>{const request=new Request('http://localhost'+CANONICAL_ARTIFACT_READ_PATH+'?id='+id);attachActor(request,{credential:'session',userId});return app.fetch(request);};
  const before=await getArtifactById(row.id);
  const response=await read(owner.userId!);expect(response.status).toBe(200);
  const body=await response.json();expect(body).toMatchObject({id:row.id,title:'Private'});expect(body).not.toHaveProperty('shares');expect(body).not.toHaveProperty('capabilities');
  expect((await getArtifactById(row.id))!.version).toBe(before!.version);
  expect((await read(reader.userId!)).status).toBe(404);expect((await read(reader.userId!,'missing')).status).toBe(404);
  await updateSharingFor(owner,row.id,{shares:[{email:'reader@example.test',role:'viewer'}]});
  expect((await read(reader.userId!)).status).toBe(200);
  expect((await sql('SELECT user_id FROM artifact_shares WHERE artifact_id=$1',[row.id]))[0].user_id).toBeNull();
  await updateSharingFor(owner,row.id,{shares:[]});expect((await read(reader.userId!)).status).toBe(404);
  const group=await createGroup(owner.userId,{handle:'readers',name:'Readers'});
  await admitGroupMember(owner.userId,group.id,reader.userId,'member');
  await setArtifactGroupShare(owner,row.id,group.id,'viewer');
  expect((await read(reader.userId!)).status).toBe(200);
  await removeGroupMember(owner.userId,group.id,reader.userId);
  expect((await read(reader.userId!)).status).toBe(404);
 });
});
