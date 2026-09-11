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
