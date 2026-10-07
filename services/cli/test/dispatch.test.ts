import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {saveTestConnection} from './connection';
import {digest} from '../src/files';
test('local commands and malformed invocations never load credentials, call the server or create state',async()=>{
 const base=await mkdtemp(join(tmpdir(),'afbin-dispatch-'));const home=join(base,'home'),root=join(base,'work');await mkdir(home);await mkdir(root);
 try{
  await writeFile(join(root,'doc.jsx'),'<p>hello</p>');
  for(const args of [['-h'],['--version'],['push','-h'],['validate','doc.jsx'],['status'],['diff'],['status','--force']]){
   const output:string[]=[];const diagnostics:string[]=[];
   const code=await runCli([...args,'--json'],{cwd:root,home,env:{},interactive:false,stdout:x=>output.push(x),stderr:x=>diagnostics.push(x),fetch:async()=>assert.fail('network during local dispatch')});
   assert.equal(code,args.includes('--force')?2:0);
   assert.equal(output.length,1);assert.doesNotThrow(()=>JSON.parse(output[0]));
  }
  assert.deepEqual(await readdir(root),['doc.jsx'],'local dispatch writes nothing into the workspace');
 }finally{await rm(base,{recursive:true,force:true});}
});
test('malformed remote references fail before authentication',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-invalid-remote-'));
 try{
  await writeFile(join(root,'doc.jsx'),'<p>Hello</p>');
  for(const [args,expected] of [
   [['push','doc.jsx@2'],'version_not_writable'],
   [['comment','doc.jsx@2'],'version_not_writable'],
   [['delete','doc.jsx'],'unpublished_file'],
   [['log','missing.jsx'],'invalid_reference'],
  ] as Array<[string[],string]>){
   const output:string[]=[];
   await runCli([...args,'--json'],{cwd:root,home:root,env:{},interactive:false,stdout:x=>output.push(x),stderr:()=>{},fetch:async()=>assert.fail('network before local validation')});
   assert.equal(JSON.parse(output.join('')).error.code,expected,args.join(' '));
  }
 }finally{await rm(root,{recursive:true,force:true});}
});

test('an empty dry-run push needs no credentials, network or local state',async()=>{
 const base=await mkdtemp(join(tmpdir(),'afbin-empty-preflight-'));const home=join(base,'home'),root=join(base,'work');await mkdir(home);await mkdir(root);
 try{
  const output:string[]=[];
  const code=await runCli(['push','--dry-run','--json'],{cwd:root,home,env:{},interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async()=>assert.fail('empty dry-run made HTTP')});
  assert.equal(code,0);assert.deepEqual(JSON.parse(output.join('')),{dry_run:true,operations:[]});
  assert.deepEqual(await readdir(root),[],'an empty dry-run leaves the workspace untouched');
 }finally{await rm(base,{recursive:true,force:true});}
});
test('recognized file extensions ignore case without renaming the user file',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-extension-'));
 try{
  await writeFile(join(root,'MyReport.JSX'),'<p>Mixed-case filename</p>');
  const output:string[]=[];
  const code=await runCli(['validate','MyReport.JSX','--json'],{home:root,cwd:root,env:{},interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async()=>assert.fail('local validation must stay offline')});
  assert.equal(code,0,output.join(''));assert.equal(JSON.parse(output.join('')).files[0].path,'MyReport.JSX');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('validate numbers a fenced document\'s diagnostics by FILE line and offset, not by the body after the fence',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-validate-lines-'));
 try{
  const fence='---\ntitle: Lines\ntheme: modernist\n---\n';
  const body='<div>\n<p>ok</p>\n<Question title="t" data="$q" viz={{"kind":"vega-lite","spec":{"mark":"bar"}} />\n</div>\n';
  await writeFile(join(root,'doc.jsx'),fence+body);
  const output:string[]=[];
  const code=await runCli(['validate','doc.jsx','--json'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async()=>assert.fail('local validation must stay offline')});
  assert.equal(code,2);
  const [file]=JSON.parse(output.join('')).files;const [diag]=file.diagnostics;
  assert.equal(diag.code,'invalid_markup');
  assert.match(diag.message,/`viz=\{` opened on line 7 is never closed/,diag.message);
  assert.doesNotMatch(diag.message,/line 3\b/,diag.message);
  assert.ok(diag.start>=fence.length,`start ${diag.start} is inside the fence`);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('validate repairs a brace count it can prove, rewrites the file, and reports the repair as a notice instead of a refusal',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-brace-repair-'));
 try{
  const fence='---\ntitle: Braces\n---\n';
  await writeFile(join(root,'rows.csv'),'m,v\na,1\n');
  // The shape observed in the wild: the object closed, then two stray `}` before ` />`.
  await writeFile(join(root,'doc.jsx'),fence+'<Helmet><Import name="q_data" src="ref:abc123" /><Query name="q">{`select m, v from q_data.rows`}</Query></Helmet><article><Question data="$q" viz={{"kind":"vega-lite","spec":{"mark":"line","encoding":{"x":{"field":"m","type":"nominal"}}}}}}} /></article>\n');
  const output:string[]=[];
  const code=await runCli(['validate','doc.jsx','--json'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async()=>assert.fail('local validation must stay offline')});
  const result=JSON.parse(output.join(''));
  assert.equal(code,0,output.join(''));
  const [file]=result.files;
  assert.equal(file.valid,true);assert.equal(file.fixed,true);
  const notice=file.diagnostics.find((d:{code:string})=>d.code==='unbalanced_braces');
  assert.ok(notice,JSON.stringify(file.diagnostics));assert.equal(notice.severity,'notice');assert.match(notice.message,/removed 2 closing braces/);
  const rewritten=await readFile(join(root,'doc.jsx'),'utf8');
  assert.ok(rewritten.startsWith(fence),'the fence is kept');
  assert.ok(rewritten.includes('"nominal"}}}}} />'),rewritten);
  // …and validate then answers what was verified, so no hand-rolled JSON check is needed.
  assert.deepEqual(result.files[0].diagnostics.filter((d:{severity?:string})=>d.severity!=='notice'),[]);
  assert.deepEqual(result.verified,[{path:'doc.jsx',title:'Braces',queries:['q'],charts:1,checks:['markup validated','1 query dry-run against the published dataset','1 chart checked against query columns','title and metadata accepted']}]);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('a directory tracked against one server refuses another by name, before any request — a bare 409 cost an agent twenty steps',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-wrong-server-'));const home=join(root,'home');const cwd=join(root,'work');await mkdir(home);await mkdir(cwd);
 const head={id:'abc123',version:1,edit_id:'edit1',state:digest('s1'),markup:'<p id="p001">Head</p>',format:'markup',title:'T',theme:null,template:null,visibility:'unlisted',link_role:'viewer',parent_id:null};
 const sent:Array<{host:string;path:string;authorization:string|null}>=[];
 const request:typeof fetch=async(input,init)=>{const url=new URL(String(input));sent.push({host:url.host,path:url.pathname,authorization:new Headers(init?.headers).get('authorization')});if(url.pathname==='/api/artifacts/abc123')return Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}});throw new Error(`Unexpected ${url}`);};
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{cwd,home,interactive:false,fetch:request,stdout:x=>out.push(x),stderr:()=>{}});return{code,result:JSON.parse(out.join(''))};};
 try{
  await saveTestConnection({server:'https://one.example',token:'mx_one'},home);await saveTestConnection({server:'https://two.example',token:'mx_two'},home);
  const pulled=await invoke(['pull','abc123','--output','doc.jsx','--server','https://one.example']);assert.equal(pulled.code,0,JSON.stringify(pulled.result));
  await writeFile(join(cwd,'doc.jsx'),(await readFile(join(cwd,'doc.jsx'),'utf8')).replace('Head','Local'));
  const refused=await invoke(['push','doc.jsx','--server','https://two.example']);
  assert.notEqual(refused.code,0);assert.equal(refused.result.error.code,'wrong_server',JSON.stringify(refused.result));
  assert.match(refused.result.error.message,/tracked against https:\/\/one\.example; the command selected https:\/\/two\.example/);
  assert.match(refused.result.error.fix,/another directory, or pass --server https:\/\/one\.example/);
  // Nothing of this command reaches the other server: no artifact request, no account header and
  // above all no token. Whether the two origins are one deployment is settled first
  // (services/cli/src/server-identity); this fixture's hosts have already answered that they are
  // not, so the refusal is reached without a single request leaving for two.example.
  const other=sent.filter(call=>call.host==='two.example');
  assert.deepEqual(other.map(call=>call.path),[],`no request reached the other server: ${JSON.stringify(sent)}`);
  for(const call of other)assert.equal(call.authorization,null,'no credential reaches a server the workspace is not tracked against');
 }finally{await rm(root,{recursive:true,force:true});}
});

/**
 * THE REFUSAL CARRIES ITS OWN DIAGNOSIS. Without --json a refused push printed exactly
 * "validation_failed: Local validation failed." and its fix line, so the agent's next call was
 * `afbin validate` purely to READ the message it had already been handed. The printer holds the
 * details in both shapes — the per-file
 * diagnostics of a local validation and the `details` strings of a server refusal — so it prints
 * them, once, between the message and the fix.
 */
test('a refused push prints the diagnostics it already carries, so reading them costs no second call',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-refusal-details-'));
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},root);
  await writeFile(join(root,'doc.jsx'),'---\ntitle: Braces\n---\n<article><Question data="$q" viz={{"kind":"vega-lite","spec":{"mark":"line"}} /></article>\n');
  const out:string[]=[];const err:string[]=[];
  const code=await runCli(['push','doc.jsx','--server','https://example.com'],{cwd:root,home:root,env:{},interactive:false,color:false,
   stdout:s=>out.push(s),stderr:s=>err.push(s),fetch:async()=>assert.fail('a local validation failure must never reach the network')});
  assert.equal(code,2,err.join(''));
  const text=err.join('');
  const lines=text.trimEnd().split('\n');
  assert.equal(lines[0],'validation_failed: Local validation failed.');
  assert.match(lines[1]!,/^doc\.jsx: JSX syntax error/,text);
  assert.match(lines[1]!,/never closed/,'the diagnostic itself, not a restatement of the code');
  assert.equal(lines[lines.length-1],'Run afbin validate and correct the reported errors.','the fix stays last');
  assert.equal(text.split('never closed').length-1,1,'printed exactly once');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('a server refusal prints its details once — and never twice when the message is already built from them',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-server-details-'));
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},root);
  await writeFile(join(root,'doc.jsx'),'---\ntitle: Sales\n---\n<article><p>Hello</p></article>\n');
  const details=['<Query name="monthly">: Dataset SQL: function strptime is not allowed'];
  const run=async(payload:Record<string,unknown>)=>{
   const err:string[]=[];
   const code=await runCli(['push','doc.jsx','--server','https://example.com'],{cwd:root,home:root,env:{},interactive:false,color:false,
    stdout:()=>{},stderr:s=>err.push(s),fetch:async()=>Response.json({error:'invalid_sql',...payload},{status:400,headers:{'X-Artifactbin-Account':'usr_seed'}})});
   return{code,text:err.join('')};
  };
  const named=await run({message:'The document was refused.',details});
  assert.equal(named.code,1,named.text);
  assert.ok(named.text.includes('invalid_sql: The document was refused.'),named.text);
  assert.equal(named.text.split(details[0]!).length-1,1,`the detail is printed once: ${named.text}`);
  assert.ok(named.text.indexOf(details[0]!)>named.text.indexOf('The document was refused.'),'after the message');
  const bare=await run({details});
  assert.ok(bare.text.includes(details[0]!),bare.text);
  assert.equal(bare.text.split(details[0]!).length-1,1,`a details-only refusal folds them into the message and must not repeat them: ${bare.text}`);
 }finally{await rm(root,{recursive:true,force:true});}
});

/**
 * TWO SITES, AND BOTH LINE NUMBERS STILL BELONG TO THE FILE. The repair now names every site it
 * fixed, and the CLI moves each one past the YAML fence by rewriting `line N` — a notice that said
 * "lines 4, 5" would name body lines and send the author two lines up, which is the fault the fence
 * shift exists to prevent (17 calls and 130 s to locate one brace).
 */
test('a repair at two sites reports both by FILE line, past the metadata fence',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-brace-lines-'));
 try{
  const fence='---\ntitle: Braces\n---\n';
  await writeFile(join(root,'doc.jsx'),fence+[
   '<Helmet><Value name="a" type="table" value={[{"x":1}]} /><Value name="b" type="table" value={[{"x":1}]} /></Helmet><article>',
   '<Question data="$a" viz={{"kind":"table"}}} />',
   '<Question data="$b" viz={{"kind":"table"}}}} />',
   '</article>',
  ].join('\n')+'\n');
  const output:string[]=[];
  const code=await runCli(['validate','doc.jsx','--json'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async()=>assert.fail('local validation must stay offline')});
  assert.equal(code,0,output.join(''));
  const notice=JSON.parse(output.join('')).files[0].diagnostics.find((d:{code:string})=>d.code==='unbalanced_braces');
  assert.ok(notice,output.join(''));
  assert.match(notice.message,/removed 3 closing braces/,'the total, not the first site');
  // Body lines 2 and 3 sit on file lines 5 and 6 under a three-line fence.
  assert.match(notice.message,/on line 5, line 6/,notice.message);
  const rewritten=await readFile(join(root,'doc.jsx'),'utf8');
  assert.ok(rewritten.startsWith(fence),'the fence is kept');
  assert.equal(rewritten.split('viz={{"kind":"table"}} />').length-1,2,rewritten);
 }finally{await rm(root,{recursive:true,force:true});}
});

/** The refusal names at most three failing files; the rest are one counted line, not a wall. */
test('a refusal that names files stops at three and counts the rest',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-refusal-cap-'));
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},root);
  for(const name of ['a','b','c','d'])await writeFile(join(root,`${name}.jsx`),`<article><Question data="$q" viz={{"kind":"line"} /></article>\n`);
  const err:string[]=[];
  const code=await runCli(['push','a.jsx','b.jsx','c.jsx','d.jsx','--server','https://example.com'],{cwd:root,home:root,env:{},interactive:false,color:false,
   stdout:()=>{},stderr:s=>err.push(s),fetch:async()=>assert.fail('a local validation failure must never reach the network')});
  assert.equal(code,2,err.join(''));
  const named=['a.jsx','b.jsx','c.jsx','d.jsx'].filter(name=>err.join('').includes(`${name}: JSX syntax error`));
  assert.equal(named.length,3,`three files named, not ${named.length}: ${err.join('')}`);
  assert.match(err.join(''),/… and 1 more files?; run afbin validate for the rest\./,err.join(''));
 }finally{await rm(root,{recursive:true,force:true});}
});

/**
 * THE CODE IS NAMED ONCE. `http.ts` builds a refusal's message as "<code>: <text>" so the message
 * carries its own code wherever it is read, and the printer then prefixed the code again — every
 * human refusal line read "invalid_sql: invalid_sql: …". The printer owns the human line, so it is
 * the one place that fixes it: a message that already opens with its code is printed from after it.
 * `--json` is untouched — its `message` is still exactly what the server's error produced.
 */
test('a refusal names its code once on the human line, whatever shape the message arrived in',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-code-once-'));
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},root);
  await writeFile(join(root,'doc.jsx'),'---\ntitle: Sales\n---\n<article><p>Hello</p></article>\n');
  const run=async(payload:Record<string,unknown>,json=false)=>{
   const out:string[]=[];const err:string[]=[];
   const code=await runCli(['push','doc.jsx','--server','https://example.com',...(json?['--json']:[])],{cwd:root,home:root,env:{},interactive:false,color:false,
    stdout:s=>out.push(s),stderr:s=>err.push(s),fetch:async()=>Response.json(payload,{status:400,headers:{'X-Artifactbin-Account':'usr_seed'}})});
   return{code,text:err.join(''),json:out.join('')};
  };
  const refused=await run({error:'invalid_sql',message:'Dataset SQL: function strptime is not allowed'});
  assert.equal(refused.text.trimEnd().split('\n')[0],'invalid_sql: Dataset SQL: function strptime is not allowed',refused.text);
  assert.ok(!refused.text.includes('invalid_sql: invalid_sql'),refused.text);
  // The envelope keeps the server's own message, code and all: only the printed line changed.
  const enveloped=await run({error:'invalid_sql',message:'Dataset SQL: function strptime is not allowed'},true);
  assert.equal(JSON.parse(enveloped.json).error.message,'invalid_sql: Dataset SQL: function strptime is not allowed');
  // A details-only refusal: http.ts builds the message out of the details, still behind one code.
  const bare=await run({error:'invalid_sql',details:['<Query name="q">: column "reveune" does not exist']});
  assert.equal(bare.text.trimEnd().split('\n')[0],'invalid_sql: <Query name="q">: column "reveune" does not exist',bare.text);
  // And a message that never carried its code is printed whole, with the code in front exactly once.
  const plain=await run({error:'quota_exceeded',message:'Your account is over its byte quota.'});
  assert.equal(plain.text.trimEnd().split('\n')[0],'quota_exceeded: Your account is over its byte quota.',plain.text);
  // auth_required writes its own message the same way, and its details are `{http_status:401}` —
  // a value for --json, never a line for a person.
  const err:string[]=[];
  const unauthorized=await runCli(['push','doc.jsx','--dry-run','--server','https://example.com'],{cwd:root,home:root,env:{},interactive:false,color:false,
   stdout:()=>{},stderr:s=>err.push(s),fetch:async()=>new Response('{}',{status:401,headers:{'Content-Type':'application/json'}})});
  assert.equal(unauthorized,2,err.join(''));
  assert.equal(err.join('').trimEnd().split('\n')[0],'auth_required: sign-in is required.',err.join(''));
  assert.ok(!err.join('').includes('http_status'),err.join(''));
 }finally{await rm(root,{recursive:true,force:true});}
});

/**
 * THE JSON OBJECT HANDED STRAIGHT TO THE ATTRIBUTE, end to end. From the first live leg of the
 * merged build (pi deck, local21): the generator wrote `viz={"kind": "vega-lite", …}` — the object
 * with ONE brace — the CLI named it and refused with `fixed:false`, pi over-corrected to `viz={{{`,
 * inspected the file, and fixed it: four calls. Now `afbin validate` rewrites the file and says so.
 */
test('validate wraps a JSON attribute value that was missing its expression braces, and reports it as a notice',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-json-wrap-'));
 try{
  const fence='---\ntitle: Chart\n---\n';
  await writeFile(join(root,'doc.jsx'),fence+[
   '<Helmet><Value name="q" type="table" value={[{"x":"a","y":1}]} /></Helmet><article>',
   '<Question data="$q" viz={"kind": "vega-lite", "spec": {"mark": "line", "encoding": {"x": {"field": "x", "type": "nominal"}}}} />',
   '</article>',
  ].join('\n')+'\n');
  const output:string[]=[];
  const code=await runCli(['validate','doc.jsx','--json'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async()=>assert.fail('local validation must stay offline')});
  assert.equal(code,0,output.join(''));
  const [file]=JSON.parse(output.join('')).files;
  assert.equal(file.valid,true);assert.equal(file.fixed,true);
  const notice=file.diagnostics.find((d:{code:string})=>d.code==='unbalanced_braces');
  assert.ok(notice,JSON.stringify(file.diagnostics));
  assert.equal(notice.severity,'notice');
  assert.match(notice.message,/wrapped 1 JSON attribute value/,notice.message);
  // Body line 2 is file line 5 under a three-line fence.
  assert.match(notice.message,/on line 5/,notice.message);
  const rewritten=await readFile(join(root,'doc.jsx'),'utf8');
  assert.ok(rewritten.startsWith(fence),'the fence is kept');
  assert.ok(rewritten.includes('viz={{"kind": "vega-lite"'),rewritten);
  assert.ok(rewritten.includes('value={[{"x":"a","y":1}]}'),'a legal array attribute is untouched');
  assert.equal(await runCli(['validate','doc.jsx','--json'],{cwd:root,home:root,env:{},interactive:false,stdout:()=>{},stderr:()=>{},fetch:async()=>assert.fail('offline')}),0,'the rewritten file validates clean');
 }finally{await rm(root,{recursive:true,force:true});}
});


test('managed review reads the hosted thread after pulling its artifact into the workspace',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-managed-comment-')),home=join(root,'home'),cwd=join(root,'work');await mkdir(home);await mkdir(cwd);
 const server='https://managed-comments.example',sent:Array<{path:string;method:string;body:Record<string,unknown>|null;headers:Headers}>=[];
 const env={ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'mxmx_test_managed_comment_token',ARTIFACTBIN__REMOTE_SESSION:'mxmx_test_session',ARTIFACTBIN__REMOTE_PROOF:'mxmx_test_proof',ARTIFACTBIN_SKILLS:'off',CLI__AUTO_UPDATE:'0'};
 const head={id:'abc123',version:1,edit_id:'edit1',state:digest('managed-head'),markup:'<p id="p001">Synthetic</p>',format:'markup',title:'Synthetic',theme:null,template:null,visibility:'private',link_role:'viewer',parent_id:null,capabilities:{comment_receipts:true}};
 const request:typeof fetch=async(input,init)=>{const url=new URL(String(input)),body=init?.body?JSON.parse(String(init.body)):null;sent.push({path:url.pathname,method:init?.method??'GET',body,headers:new Headers(init?.headers)});const headers={'X-Artifactbin-Account':'mxmx_test_account'};if(url.pathname==='/api/artifacts/abc123')return Response.json(head,{headers});if(url.pathname.includes('annotations'))return Response.json(init?.method==='POST'?{id:'ann_hosted',status:body?.resolve?'resolved':'open',thread:[{body:'Hosted request'},{body:body?.reply}]}:{annotations:[{id:'ann_hosted',thread:[{body:'Hosted request'}]}],next_cursor:null},{headers});throw Error('Unexpected synthetic route '+url.pathname);};
 const invoke=async(args:string[],scope:NodeJS.ProcessEnv=env)=>{const out:string[]=[];const code=await runCli([...args,'--json'],{cwd,home,env:scope,interactive:false,fetch:request,stdout:x=>out.push(x),stderr:()=>{}});return{code,result:JSON.parse(out.join(''))};};
 try{
  await writeFile(join(cwd,'other.jsx'),'<p id="local">Other local document</p>');const added=await invoke(['add','other.jsx']);assert.equal(added.code,0,JSON.stringify(added.result));
  const pulled=await invoke(['pull','abc123','--output','doc.jsx']);assert.equal(pulled.code,0,JSON.stringify(pulled.result));sent.length=0;
  const listed=await invoke(['comment','abc123']);assert.equal(listed.code,0,JSON.stringify(listed.result));
  assert.equal(listed.result.annotations[0]?.id,'ann_hosted','managed bare-ID comment must read hosted request rather than empty local discussion');
  assert.ok(sent.some(call=>call.path.includes('annotations')),'hosted comment endpoint was used');
  for(const phase of ['acknowledged','completed']){
   sent.length=0;const reply=await invoke(['comment','abc123','--thread','ann_hosted','--body','Hosted '+phase,'--request','request_hosted','--phase',phase]);assert.equal(reply.code,0,JSON.stringify(reply.result));
   const posts=sent.filter(call=>call.method==='POST');assert.equal(posts.length,1);assert.equal(posts[0]?.path,'/api/artifacts/abc123/annotations/ann_hosted');assert.deepEqual(posts[0]?.body,{request_id:'request_hosted',phase,reply:'Hosted '+phase});
   assert.equal(posts[0]?.headers.get('X-Artifactbin-Remote-Session'),env.ARTIFACTBIN__REMOTE_SESSION);assert.equal(posts[0]?.headers.get('X-Artifactbin-Remote-Proof'),env.ARTIFACTBIN__REMOTE_PROOF);
  }
  sent.length=0;const resolved=await invoke(['comment','abc123','--thread','ann_hosted','--state','resolved']);assert.equal(resolved.code,0,JSON.stringify(resolved.result));assert.deepEqual(sent.filter(call=>call.method==='POST')[0]?.body,{resolve:true});
  const unmanaged={...env,ARTIFACTBIN__REMOTE_SESSION:undefined,ARTIFACTBIN__REMOTE_PROOF:undefined};
  sent.length=0;const local=await invoke(['comment','abc123','--node','p001','--body','Ordinary local review'],unmanaged);assert.equal(local.code,0,JSON.stringify(local.result));assert.equal(local.result.local,true);assert.equal(sent.length,0);
  const before=await invoke(['comment','doc.jsx']);assert.equal(before.code,0);assert.equal(before.result.local,true);assert.equal(before.result.annotations.length,1);assert.equal(sent.length,0);
  const explicitReply=await invoke(['comment','doc.jsx','--thread',local.result.id,'--body','Local follow-up']);assert.equal(explicitReply.code,0);assert.equal(explicitReply.result.local,true);assert.equal(sent.length,0);
  const beforeInvalid=await invoke(['comment','doc.jsx']);const source=await readFile(join(cwd,'doc.jsx'),'utf8');
  for(const [args,scope,error] of [
   [['comment','abc123','--thread','ann_hosted','--body','Unproven','--request','request_hosted','--phase','completed'],{...env,ARTIFACTBIN__REMOTE_PROOF:undefined},'unsupported_local_comment'],
   [['comment','doc.jsx','--thread',local.result.id,'--body','Wrong local phase','--request','request_hosted','--phase','completed'],env,'unsupported_local_comment'],
   [['comment','abc123','doc.jsx','--node','p001','--body','Mixed'],env,'unsupported_local_comment'],
   [['comment','abc123','other.jsx','--node','p001','--body','Mixed unpublished'],env,'unsupported_local_comment'],
   [['comment','abc123@2'],env,'version_not_writable'],
   [['comment','https://other.example/a/abc123'],env,'wrong_server'],
  ] as Array<[string[],NodeJS.ProcessEnv,string]>){sent.length=0;const rejected=await invoke(args,scope);assert.notEqual(rejected.code,0);assert.equal(rejected.result.error.code,error,args.join(' '));assert.equal(sent.filter(call=>call.method==='POST').length,0);assert.equal(await readFile(join(cwd,'doc.jsx'),'utf8'),source);}
  sent.length=0;const afterInvalid=await invoke(['comment','doc.jsx']);assert.deepEqual(afterInvalid.result,beforeInvalid.result);assert.equal(sent.length,0);
  const fresh=await invoke(['comment','other.jsx','--node','local','--body','Unpublished local']);assert.equal(fresh.code,0);assert.equal(fresh.result.local,true);assert.equal(sent.length,0);
  const localById=await invoke(['comment','abc123'],unmanaged);assert.equal(localById.code,0);assert.equal(localById.result.local,true);assert.equal(localById.result.annotations[0].thread.length,2);assert.equal(sent.length,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
