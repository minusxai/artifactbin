import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateFiles} from '../src/validation';
import {loadWorkspace} from '../src/workspace';
test('validates local dependency paths and fixes tags without network or state creation',async()=>{
 const base=await mkdtemp(join(tmpdir(),'afbin-validate-'));const home=join(base,'home'),root=join(base,'work');await mkdir(home);await mkdir(root);const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>assert.fail('local validation made a network request');
 try{
  await writeFile(join(root,'data.csv'),'n\n1\n');
  const body='<Helmet><Query  name = "q" source = "./data.csv">{`select n from public.rows`}</Query></Helmet><Table data="$q" />';
  await writeFile(join(root,'doc.jsx'),body);
  const workspace=await loadWorkspace(root,home);
  assert.equal((await validateFiles(workspace,['doc.jsx'])).valid,true);
  assert.equal(await readFile(join(root,'doc.jsx'),'utf8'),body);
  const fixed=await validateFiles(workspace,['doc.jsx'],true);assert.equal(fixed.valid,true);assert.equal(fixed.files[0].fixed,true);
  assert.ok((await readFile(join(root,'doc.jsx'),'utf8')).includes('source="./data.csv"'));
  assert.deepEqual((await readdir(root)).sort(),['data.csv','doc.jsx'],'validation writes nothing into the workspace');
  await writeFile(join(root,'bad.jsx'),'<Bogus />');assert.equal((await validateFiles(workspace,['bad.jsx'])).valid,false);
  await writeFile(join(root,'missing.jsx'),'<img src="./missing.png" />');assert.equal((await validateFiles(workspace,['missing.jsx'])).valid,false);
 }finally{globalThis.fetch=originalFetch;await rm(base,{recursive:true,force:true});}
});
