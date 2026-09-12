import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,rename,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadWorkspace,inspectWorkspace} from '../src/workspace';
import {runCli} from '../src/dispatch';
import {saveConnection} from '../src/config';
import {stageFiles} from '../src/journal';
import {State} from '../src/state';
import {digest} from '../src/files';

/** Every case runs against its own private state directory; the real ~/.artifactbin is never touched. */
async function fixture(run:(home:string,cwd:string,base:string)=>Promise<void>){
 const base=await mkdtemp(join(tmpdir(),'afbin-workspace-'));
 const home=join(base,'home'),cwd=join(base,'work');
 await mkdir(home);await mkdir(cwd);
 try{await run(home,cwd,base);}finally{await rm(base,{recursive:true,force:true});}
}

test('workspace reads use the nearest registered root and never create state or scan untracked files',()=>fixture(async(home,cwd)=>{
 const root=await realpath(cwd);
 await writeFile(join(root,'untracked.jsx'),'<p>ignored</p>');
 const empty=await loadWorkspace(root,home);assert.equal(empty.tracking,null);assert.deepEqual(await inspectWorkspace(empty),[]);
 assert.deepEqual((await readdir(root)).sort(),['untracked.jsx'],'a read establishes nothing on disk');
 await mkdir(join(root,'nested'));
 const bytes='---\nid: abc123\n---\n<p>hello</p>';
 await writeFile(join(root,'doc.jsx'),bytes);
 const state=await State.open(home);
 try{state.transaction(()=>{
  state.put(root,'workspace',root,{server:'https://example.com',account:'usr_one'});
  state.put(root,'tracked','doc.jsx',{id:'abc123',file:digest(bytes),url:'https://example.com/a/abc123',snapshot:{id:'abc123',version:1,edit_id:'editone',state:'a'.repeat(64),markup:'<p>hello</p>'}});
 });}finally{state.close();}
 const workspace=await loadWorkspace(join(root,'nested'),home);
 assert.equal(workspace.root,root);assert.equal(workspace.tracking?.server,'https://example.com');
 const status=await inspectWorkspace(workspace);assert.equal(status.length,1);assert.equal(status[0].status,'unchanged');
 await writeFile(join(root,'doc.jsx'),bytes+'\n<p>changed</p>');assert.equal((await inspectWorkspace(workspace))[0].status,'modified');
 await writeFile(join(root,'copy.jsx'),bytes);
 await assert.rejects(inspectWorkspace(workspace,['../copy.jsx']),/duplicate_identity/);
 await rename(join(root,'doc.jsx'),join(root,'renamed.jsx'));
 const renamed=await inspectWorkspace(workspace,['../renamed.jsx']);assert.equal(renamed[0].renamedFrom,'doc.jsx');
}));

test('push writes no afbin.lock and no .artifactbin directory; tracking lives in the state store with a hash, not bytes',async()=>{
 const {mkdtemp,mkdir,writeFile,readdir}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {runCli}=await import('../src/dispatch');const {saveConnection}=await import('../src/config');const {State}=await import('../src/state');const {digest}=await import('../src/files');
 const root=await mkdtemp(join(tmpdir(),'afbin-state-ws-'));const home=join(root,'home');const cwd=join(root,'work');await mkdir(home);await mkdir(cwd);
 const fetchStub:typeof fetch=async(input,init)=>{const path=new URL(String(input)).pathname;const body=JSON.parse(String(init?.body??'{}'));
  if(path==='/api/artifacts')return Response.json({id:'abc123',version:1,edit_id:'e1',state:digest('s1'),markup:body.markup,format:'markup',visibility:'unlisted',url:'https://example.com/a/abc123'},{status:201,headers:{'X-Artifactbin-Account':'usr_one'}});
  throw new Error(`Unexpected ${init?.method} ${path}`);};
 await saveConnection({server:'https://example.com',token:'mx_test'},home);await writeFile(join(cwd,'doc.jsx'),'<p>One</p>');
 const out:string[]=[];assert.equal(await runCli(['push','doc.jsx','--json'],{cwd,home,interactive:false,fetch:fetchStub,stdout:x=>out.push(x),stderr:()=>{}}),0,out.join(''));
 assert.deepEqual((await readdir(cwd)).sort(),['doc.jsx'],'nothing but the user file lives in the workspace');
 const state=await State.open(home);
 try{
  const {realpath}=await import('node:fs/promises');const scope=await realpath(cwd);
  assert.deepEqual(state.get(scope,'workspace',scope)?.value,{server:'https://example.com',account:'usr_one'});
  const tracked=state.get<Record<string,unknown>>(scope,'tracked','doc.jsx')?.value;
  assert.ok(tracked);assert.equal(tracked.id,'abc123');assert.match(String(tracked.file),/^[a-f0-9]{64}$/);
  assert.equal('baseline' in tracked,false);assert.equal('base' in tracked,false);
  assert.equal(JSON.stringify(tracked).includes('base64'),false);
 }finally{state.close();}
 const status:string[]=[];assert.equal(await runCli(['status','--json'],{cwd,home,interactive:false,fetch:async()=>{throw new Error('offline');},stdout:x=>status.push(x),stderr:()=>{}}),0);
 assert.equal(JSON.parse(status.join('')).files[0].status,'unchanged');
});

const PNG=Buffer.from('89504e470d0a1a0a0000000d49484452','hex');
test('a tracked binary asset records only its sha256 and status detects a changed image without any stored copy',()=>fixture(async(home,cwd)=>{
 const fetchStub:typeof fetch=async(input,init)=>{const path=new URL(String(input)).pathname;
  if(path==='/api/artifacts')return Response.json({id:'img123',version:1,edit_id:'e1',state:digest('img1'),format:'image',contentType:'image/png',visibility:'unlisted',url:'https://example.com/a/img123'},{status:201,headers:{'X-Artifactbin-Account':'usr_one'}});
  throw new Error(`Unexpected ${init?.method} ${path}`);};
 await saveConnection({server:'https://example.com',token:'mx_test'},home);
 await writeFile(join(cwd,'image.png'),PNG);
 const out:string[]=[];
 assert.equal(await runCli(['push','image.png','--json'],{cwd,home,interactive:false,fetch:fetchStub,stdout:x=>out.push(x),stderr:()=>{}}),0,out.join(''));
 assert.deepEqual((await readdir(cwd)).sort(),['image.png'],'publishing a binary writes nothing beside it');
 const scope=await realpath(cwd);const state=await State.open(home);
 try{
  const tracked=state.get<Record<string,unknown>>(scope,'tracked','image.png')?.value;
  assert.ok(tracked);assert.equal(tracked.file,digest(PNG),'the record is the hash of the local bytes');
  const serialized=JSON.stringify(tracked);
  assert.equal(serialized.includes(PNG.toString('base64')),false,'no copy of the image is kept');
  assert.equal(serialized.includes('baseline'),false);
 }finally{state.close();}
 const offline=async()=>{const lines:string[]=[];const code=await runCli(['status','--json'],{cwd,home,interactive:false,fetch:async()=>{throw new Error('offline');},stdout:x=>lines.push(x),stderr:()=>{}});assert.equal(code,0);return JSON.parse(lines.join(''));};
 assert.equal((await offline()).files[0].status,'unchanged');
 await writeFile(join(cwd,'image.png'),Buffer.concat([PNG,Buffer.from([1,2,3])]));
 assert.equal((await offline()).files[0].status,'modified','a changed image is detected by hash alone');
}));

test('workspace discovery is the nearest registered ancestor, else cwd, with no marker file anywhere',()=>fixture(async(home,cwd,base)=>{
 const parent=await realpath(cwd);
 const docs=join(parent,'docs');const child=join(docs,'sub');const elsewhere=join(base,'elsewhere');
 await mkdir(child,{recursive:true});await mkdir(elsewhere);
 const fetchStub:typeof fetch=async(input,init)=>{const path=new URL(String(input)).pathname;const body=JSON.parse(String(init?.body??'{}'));
  if(path==='/api/artifacts')return Response.json({id:'abc123',version:1,edit_id:'e1',state:digest('s1'),markup:body.markup,format:'markup',visibility:'unlisted',url:'https://example.com/a/abc123'},{status:201,headers:{'X-Artifactbin-Account':'usr_one'}});
  throw new Error(`Unexpected ${init?.method} ${path}`);};
 await saveConnection({server:'https://example.com',token:'mx_test'},home);
 await writeFile(join(parent,'doc.jsx'),'<p>One</p>');
 const out:string[]=[];
 assert.equal(await runCli(['push','doc.jsx','--json'],{cwd:parent,home,interactive:false,fetch:fetchStub,stdout:x=>out.push(x),stderr:()=>{}}),0,out.join(''));
 for(const directory of [parent,docs,child])assert.deepEqual((await readdir(directory)).filter(name=>name.startsWith('.')||name==='afbin.lock'),[],`${directory} holds no marker file`);

 const fromDocs=await loadWorkspace(docs,home);
 assert.equal(fromDocs.root,parent,'a subdirectory resolves to its nearest registered ancestor');
 assert.deepEqual(Object.keys(fromDocs.tracking?.files??{}),['doc.jsx']);

 const outside=await loadWorkspace(elsewhere,home);
 assert.equal(outside.root,await realpath(elsewhere),'an unregistered directory is its own root');
 assert.equal(outside.tracking,null,'and carries no tracking');

 // A directory registered in its own right wins over the registered parent above it.
 const state=await State.open(home);
 try{state.put(child,'workspace',child,{server:'https://example.com',account:'usr_one'});}finally{state.close();}
 const fromChild=await loadWorkspace(child,home);
 assert.equal(fromChild.root,child,'the registered child wins over the registered parent');
 assert.deepEqual(Object.keys(fromChild.tracking?.files??{}),[]);
 assert.equal((await loadWorkspace(docs,home)).root,parent,'a sibling directory still resolves to the parent');
}));

test('an interrupted multi-file write is replayed from staged-file records and refuses a file the user changed meanwhile',()=>fixture(async(home,cwd)=>{
 const root=await realpath(cwd);
 await writeFile(join(root,'one.txt'),'old one');
 await writeFile(join(root,'two.txt'),'old two');
 const push=async()=>{const lines:string[]=[];const code=await runCli(['push','--json'],{cwd:root,home,interactive:false,fetch:async()=>{throw new Error('offline');},stdout:x=>lines.push(x),stderr:x=>lines.push(x)});return{code,text:lines.join('')};};

 // A crash between the transaction and the disk write leaves only records behind.
 await stageFiles(home,root,[{path:'one.txt',before:digest('old one'),data:Buffer.from('new one')},{path:'two.txt',before:digest('old two'),data:Buffer.from('new two')}]);
 assert.equal(await readFile(join(root,'one.txt'),'utf8'),'old one','nothing reached the disk yet');
 const replayed=await push();
 assert.equal(replayed.code,0,replayed.text);
 assert.equal(await readFile(join(root,'one.txt'),'utf8'),'new one');
 assert.equal(await readFile(join(root,'two.txt'),'utf8'),'new two');
 const state=await State.open(home);
 try{assert.equal(state.list(root,'staged-file').length,0,'a replayed commit clears its records');}finally{state.close();}

 // A user edit under a staged file stops recovery, and that file is left exactly as the user wrote it.
 await stageFiles(home,root,[{path:'one.txt',before:digest('new one'),data:Buffer.from('later one')},{path:'two.txt',before:digest('new two'),data:Buffer.from('later two')}]);
 await writeFile(join(root,'two.txt'),'the user typed this');
 const refused=await push();
 assert.notEqual(refused.code,0);
 assert.match(refused.text,/changed after staging/);
 assert.equal(await readFile(join(root,'two.txt'),'utf8'),'the user typed this');
 assert.equal(await readFile(join(root,'one.txt'),'utf8'),'new one','no member of a refused operation is applied');
}));
