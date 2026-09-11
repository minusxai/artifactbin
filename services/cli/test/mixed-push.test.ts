import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runCli} from '../src/dispatch';
import {saveConnection} from '../src/config';
import {digest} from '../src/files';
import {parseDocument,writeDocument} from '../src/document';

test('mixed content and metadata push rebases unrelated remote nodes before its conditional atomic write',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-mixed-push-'));let writes=0;
 let head={id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',title:'Original',markup:'<div><p id="first">First</p><p id="second">Second</p></div>'};
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{home:root,cwd:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async(_input,init)=>{
  if(init?.method==='PUT'){
   writes++;const body=JSON.parse(String(init.body));
   if(body.expectedState!==head.state)return Response.json({error:'state_conflict'},{status:409});
   assert.equal(body.expectedVersion,2);assert.equal(body.title,'My title');
   assert.match(body.markup,/Local/);assert.match(body.markup,/Remote/);
   head={...head,title:body.title,markup:body.markup,version:3,edit_id:'three',state:digest('three')};
  }else assert.equal(init?.method,'GET');
  return Response.json(head,{headers:{'X-Artifactbin-Account':'account'}});
 }});return{code,result:JSON.parse(out.join(''))};};
 try{
  await saveConnection({server:'https://example.com',token:'test'},root);assert.equal((await invoke(['pull','abc123','doc.jsx'])).code,0);
  const local=parseDocument(await readFile(join(root,'doc.jsx'),'utf8'));local.body=local.body.replace('First','Local');local.metadata.title='My title';await writeFile(join(root,'doc.jsx'),writeDocument(local));
  head={...head,version:2,edit_id:'two',state:digest('two'),markup:head.markup.replace('Second','Remote')};
  const result=await invoke(['push','doc.jsx']);assert.equal(result.code,0,JSON.stringify(result.result));assert.equal(writes,1);
  assert.match(await readFile(join(root,'doc.jsx'),'utf8'),/Remote/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('mixed push records overlapping proposals and dry-run leaves no conflict state',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-mixed-overlap-'));
 let head={id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',title:'Original',markup:'<p id="first">First</p>'};
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{home:root,cwd:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async(_input,init)=>{assert.equal(init?.method,'GET');return Response.json(head,{headers:{'X-Artifactbin-Account':'account'}});}});return{code,result:JSON.parse(out.join(''))};};
 try{
  await saveConnection({server:'https://example.com',token:'test'},root);assert.equal((await invoke(['pull','abc123','doc.jsx'])).code,0);
  const local=parseDocument(await readFile(join(root,'doc.jsx'),'utf8'));local.body=local.body.replace('First','Local');local.metadata.title='My title';await writeFile(join(root,'doc.jsx'),writeDocument(local));
  head={...head,version:2,edit_id:'two',state:digest('two'),markup:head.markup.replace('First','Remote')};
  assert.equal((await invoke(['push','doc.jsx','--dry-run'])).code,3);await assert.rejects(readFile(join(root,'.artifactbin','conflicts.json')),{code:'ENOENT'});
  assert.equal((await invoke(['push','doc.jsx'])).code,3);
  const conflict=JSON.parse(await readFile(join(root,'.artifactbin','conflicts.json'),'utf8')).conflicts.abc123;
  assert.match(conflict.details.local,/Local/);assert.match(conflict.details.remote,/Remote/);
  assert.equal((await invoke(['status'])).result.files[0].status,'conflicted');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('mixed push reconciles before dependency preflight and again using immutable local changes after upload',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-mixed-dependency-'));let creates=0,preflights=0,writes=0;
 let head={id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',title:'Original',markup:'<div><p id="first">First</p><p id="second">Second</p><p id="third">Third</p></div>'};
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{home:root,cwd:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async(input,init)=>{
  const path=new URL(String(input)).pathname,body=init?.body?JSON.parse(String(init.body)):{};
  if(path.endsWith('/preflight')){preflights++;assert.equal(body.input.expectedState,head.state);assert.match(body.input.markup,/Remote/);return Response.json({valid:true});}
  if(path==='/api/artifacts'&&init?.method==='POST'){
   creates++;head={...head,version:3,edit_id:'three',state:digest('three'),markup:head.markup.replace('Third','During upload')};
   return Response.json({id:'data123',format:'dataset',rows:[{score:42}],version:1,state:digest('data'),edit_id:'data'},{headers:{'X-Artifactbin-Account':'account'}});
  }
  if(init?.method==='PUT'){
   writes++;assert.equal(body.expectedState,head.state);assert.equal(body.expectedVersion,3);assert.match(body.markup,/Remote/);assert.match(body.markup,/During upload/);assert.match(body.markup,/ref:data123/);assert.equal(body.title,'My title');
   head={...head,...body,version:4,state:digest('four'),edit_id:'four'};
  }else assert.equal(init?.method,'GET');
  return Response.json(head,{headers:{'X-Artifactbin-Account':'account'}});
 }});return{code,result:JSON.parse(out.join(''))};};
 try{
  await saveConnection({server:'https://example.com',token:'test'},root);assert.equal((await invoke(['pull','abc123','doc.jsx'])).code,0);
  await writeFile(join(root,'sales.csv'),'score\n42\n');
  const local=parseDocument(await readFile(join(root,'doc.jsx'),'utf8'));local.body=local.body.replace('First','<a href="./sales.csv">Local data</a>');local.metadata.title='My title';await writeFile(join(root,'doc.jsx'),writeDocument(local));
  head={...head,version:2,edit_id:'two',state:digest('two'),markup:head.markup.replace('Second','Remote')};
  const result=await invoke(['push','doc.jsx']);assert.equal(result.code,0,JSON.stringify(result.result));assert.equal(creates,1);assert.equal(preflights,1);assert.equal(writes,1);
  const saved=await readFile(join(root,'doc.jsx'),'utf8');assert.match(saved,/Remote/);assert.match(saved,/During upload/);assert.match(saved,/sales.csv/);
 }finally{await rm(root,{recursive:true,force:true});}
});
