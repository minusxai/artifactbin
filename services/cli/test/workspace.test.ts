import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,stat,rm,rename,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadWorkspace,inspectWorkspace} from '../src/workspace';
import {digest} from '../src/files';

test('workspace reads use the nearest lock and never create state or scan untracked files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-workspace-'));
 try{
  await writeFile(join(root,'untracked.jsx'),'<p>ignored</p>');
  const empty=await loadWorkspace(root);assert.deepEqual(await inspectWorkspace(empty),[]);
  await assert.rejects(stat(join(root,'.artifactbin')),{code:'ENOENT'});
  await mkdir(join(root,'nested'));
  const bytes='---\nid: abc123\n---\n<p>hello</p>';
  await writeFile(join(root,'doc.jsx'),bytes);
  await writeFile(join(root,'afbin.lock'),JSON.stringify({schema:1,server:'https://example.com',account:'usr_one',root:'workspace_one',files:{'doc.jsx':{baseline:Buffer.from(bytes).toString('base64'),id:'abc123',base:digest(bytes),file:digest(bytes),url:'https://example.com/a/abc123',snapshot:{id:'abc123',version:1,edit_id:'editone',state:'a'.repeat(64),markup:'<p>hello</p>'}}}}));
  const workspace=await loadWorkspace(join(root,'nested'));
  const status=await inspectWorkspace(workspace);assert.equal(status.length,1);assert.equal(status[0].status,'unchanged');
  await writeFile(join(root,'doc.jsx'),bytes+'\n<p>changed</p>');assert.equal((await inspectWorkspace(workspace))[0].status,'modified');
  await writeFile(join(root,'copy.jsx'),bytes);
  await assert.rejects(inspectWorkspace(workspace,['../copy.jsx']),/duplicate_identity/);
  await rename(join(root,'doc.jsx'),join(root,'renamed.jsx'));
  const renamed=await inspectWorkspace(workspace,['../renamed.jsx']);assert.equal(renamed[0].renamedFrom,'doc.jsx');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('an interrupted first mutation anchors workspace discovery before the first lock exists',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-pending-root-'));
 try{
  await mkdir(join(root,'nested'));await mkdir(join(root,'.artifactbin'));
  await writeFile(join(root,'.artifactbin','pending-request.json'),'{}');
  const workspace=await loadWorkspace(join(root,'nested'));
  assert.equal(workspace.root,await realpath(root));assert.equal(workspace.lock,null);
 }finally{await rm(root,{recursive:true,force:true});}
});
