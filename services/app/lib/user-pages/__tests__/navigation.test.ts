import { expect, it } from 'vitest';
import { mintAccountToken, useAppHarness } from '@/__tests__/harness';
import { seedArtifacts, setArtifact } from '@/__tests__/rows';
import { setUsername } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { saveSiteRoot, siteDestination, siteOwner } from '..';

useAppHarness();

it('resolves configured directories, explicit workspace roots and legacy homes from live placement', async () => {
  const account = await mintAccountToken('mxmx_test_directories');
  const db = await getDb(), user_id = account.userId!, handle = 'publisher';
  await setUsername(user_id,handle);
  const row = (id:string, title:string, format:string, ancestor_ids:string[]) =>
    ({id,title,format,ancestor_ids,user_id,visibility:'public'});
  await seedArtifacts(db,
    row('blog001','Blog','folder',[]),
    row('test001','Testing','folder',['blog001']),
    row('docu001','Documentary','html',['blog001']),
    row('dev0001','Dev','html',['blog001','test001']),
    row('index01','Index','html',['blog001']),
  );
  await saveSiteRoot(user_id,'blog','blog001');
  async function cases(label:string, expected:Record<string,string|null>) {
    const owner = await siteOwner({handle,label});
    expect(owner).toBeTruthy();
    for (const [path,id] of Object.entries(expected)) {
      const destination = await siteDestination(owner!,path);
      expect(destination?.kind==='page' ? destination.id : destination?.kind??null, label+path).toBe(id);
    }
  }
  const children = {'/documentary':'docu001','/testing/dev':'dev0001','/dev':null};
  const directories = {'/testing':null,'/testing/':null,'/folders/test001':null};
  await cases('blog',{'/':'index01',...children,...directories});
  // Legacy roots use the earliest eligible account-wide index.
  await cases('',{'/':'index01'});
  await setArtifact(db,'index01',{visibility:'unlisted'});
  await cases('blog',{'/':null,...children,...directories});
  await cases('',{'/':'listing'});
  await saveSiteRoot(user_id,'',null);
  await cases('',{'/':null,'/blog/documentary':'docu001','/blog/testing/dev':'dev0001'});
  await setArtifact(db,'index01',{ancestor_ids:['blog001','test001'],visibility:'private'});
  await cases('blog',directories);
  await setArtifact(db,'index01',{visibility:'public'});
  await cases('blog',{'/testing':'index01','/testing/':'index01','/folders/test001':'index01','/':null});
  await setArtifact(db,'index01',{ancestor_ids:[]});
  await cases('',{'/':'index01'});
});
