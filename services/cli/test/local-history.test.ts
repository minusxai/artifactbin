import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rename,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {localHistory,localHistoryHead,moveLocalHistory} from '../src/local-history';
import {localWorkspaceState,saveLocalFile} from '../src/local-workspace';
import {digest} from '../src/files';


test('portable history follows a document move and rejects archive collisions without losing either history',async()=>{
 const root=await mkdtemp(join(tmpdir(),'history-move-'));
 try{
  const old=Buffer.from('<p id="same">First</p>'),next=Buffer.from('<p id="same">Second</p>');
  await writeFile(join(root,'old.jsx'),old);
  const store=await localWorkspaceState(root);
  await saveLocalFile(root,'old.jsx',digest(old),next);
  store.transaction(()=>moveLocalHistory(store,'old.jsx','new.jsx'));
  await rename(join(root,'old.jsx'),join(root,'new.jsx'));
  assert.equal((await localHistoryHead(root,'new.jsx')).version,2);
  assert.match((await localHistory(root,'new.jsx'))[0]!.body,/First/);
  await writeFile(join(root,'occupied.jsx'),old);
  await saveLocalFile(root,'occupied.jsx',digest(old),next);
  assert.throws(()=>store.transaction(()=>moveLocalHistory(store,'new.jsx','occupied.jsx')),/another local history/);
  assert.equal((await localHistory(root,'new.jsx')).length,1);
  assert.equal((await localHistory(root,'occupied.jsx')).length,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
