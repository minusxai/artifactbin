import {it,expect} from 'vitest';
it('binds targets to one origin and rejects target/server mismatches',async()=>{
 const {resolveTarget}=await import('../../../skills/artifactbin/scripts/toolbox-client.mjs');
 expect(resolveTarget('https://example.test/a/PAGE12','https://example.test')).toEqual({server:'https://example.test',id:'PAGE12'});
 expect(()=>resolveTarget('https://example.test/a/PAGE12','https://other.test')).toThrow();
 expect(()=>resolveTarget('https://user:secret@example.test/a/PAGE12')).toThrow();
});
it('validates GraphQL selected operation type before transport',async()=>{
 const {selectedOperation}=await import('../../../skills/artifactbin/scripts/toolbox-graphql.mjs');
 expect(await selectedOperation('query A{x} mutation B{y}','B','mutate')).toBe('mutation');
 await expect(selectedOperation('mutation {increment}',undefined,'query')).rejects.toThrow();
 await expect(selectedOperation('query A{x} query B{y}',undefined,'query')).rejects.toThrow();
 await expect(selectedOperation('subscription {x}',undefined,'query')).rejects.toThrow();
});
it('retains exact journal snapshots after unknown writes and refuses cross-origin replay',async()=>{
 const {mkdtemp,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {makeClient,createJournal,journalIntent,resumeJournal}=await import('../../../skills/artifactbin/scripts/toolbox-client.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'author-journal-'));const server='https://example.test';
 try{
  let fail=true;const calls:any[]=[];const fetcher=async(url:any,init:any)=>{calls.push({url:String(url),...init});if(fail)throw Error('lost');return Response.json({id:'PAGE12',version:1});};
  const client=makeClient(server,{env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'private-fixture',ARTIFACTBIN_HOME:root},fetcher});
  const journal=await createJournal(journalIntent({server,method:'POST',path:'/api/artifacts',body:{html:'<h1>One</h1>'},operation:'publish'}),{root});
  await expect(resumeJournal(journal,client,'publish')).rejects.toMatchObject({code:'outcome_unknown',exit:5,details:{journal}});
  fail=false;expect((await resumeJournal(journal,client,'publish')).receipt.id).toBe('PAGE12');
  expect(calls[0].body).toBe(calls[1].body);expect(calls[0].headers['Idempotency-Key']).toBe(calls[1].headers['Idempotency-Key']);
  expect(await readFile(journal,'utf8')).not.toContain('private-fixture');
  await expect(resumeJournal(journal,{...client,server:'https://other.test'},'publish')).rejects.toMatchObject({code:'invalid_journal'});
 }finally{await rm(root,{recursive:true,force:true});}
});
it('flushes watch events before checkpoints, deduplicates replay and validates append identity',async()=>{
 const {mkdtemp,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {watchComments}=await import('../../../skills/artifactbin/scripts/toolbox-comments.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'author-watch-')),output=path.join(root,'feed.ndjson');
 try{
  let calls=0;const client={server:'https://example.test',request:async()=>({events:[{event_id:'e1',kind:'comment_created'}],next_cursor:'opaque'+(++calls),has_more:calls===1})};
  await watchComments(client,'PAGE12',{once:true,output});
  const records=(await readFile(output,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  expect(records.map(record=>record.kind)).toEqual(['watch','event','checkpoint','checkpoint']);
  await watchComments(client,'PAGE12',{once:true,append:true,output});
  expect((await readFile(output,'utf8')).match(/"kind":"event"/g)).toHaveLength(1);
  await expect(watchComments({...client,server:'https://other.test'},'PAGE12',{once:true,append:true,output})).rejects.toMatchObject({code:'log_mismatch'});
 }finally{await rm(root,{recursive:true,force:true});}
});
it('classifies unreadable successful write bodies as unknown without automatic replay',async()=>{
 const {makeClient}=await import('../../../skills/artifactbin/scripts/toolbox-client.mjs');
 for(const route of ['/api/artifacts','/api/artifacts/PAGE12/annotations','/api/artifacts/PAGE12/graphql']){
  let calls=0;const client=makeClient('https://example.test',{env:{ARTIFACTBIN_URL:'https://example.test',ARTIFACTBIN_TOKEN:'synthetic'},fetcher:async()=>{calls++;return new Response('{"truncated":',{status:200});}});
  await expect(client.request(route,{method:'POST',body:{},unsafe:true})).rejects.toMatchObject({code:'outcome_unknown',exit:5});expect(calls).toBe(1);
 }
});
it('exports actual image bytes exclusively and reports dimensions',async()=>{
 const {mkdtemp,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {exportCommand}=await import('../../../skills/artifactbin/scripts/export.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'author-export-')),output=path.join(root,'slide.png');
 try{
  const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(390,16);png.writeUInt32BE(844,20);
  const calls:any[]=[];const options={env:{ARTIFACTBIN_URL:'https://example.test',ARTIFACTBIN_TOKEN:'synthetic'},fetcher:async(url:any,init:any)=>{calls.push({url:String(url),init});return new Response(png,{headers:{'content-type':'image/png'}});}};
  expect(await exportCommand({values:{format:'png',slide:'2',output},positionals:['PAGE12']},options)).toMatchObject({width:390,height:844,outputOwned:true});
  expect(await readFile(output)).toEqual(png);expect(calls[0].url).toContain('/a/PAGE12/export?format=png&slide=2');
  await expect(exportCommand({values:{format:'png',output},positionals:['PAGE12']},options)).rejects.toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
});
it('validates selected GraphQL against SDL and never replays an unknown mutation',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {graphqlCommand}=await import('../../../skills/artifactbin/scripts/graphql.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'author-graphql-')),document=path.join(root,'op.graphql');
 try{
  let writes=0;const options={env:{ARTIFACTBIN_URL:'https://example.test',ARTIFACTBIN_TOKEN:'synthetic'},fetcher:async(_url:any,init:any)=>{if(init.method==='GET')return Response.json({sdl:'type Query{count:Int} type Mutation{increment:Int}',revision:'3'});writes++;return new Response('{',{status:200});}};
  await writeFile(document,'mutation { increment }');
  await expect(graphqlCommand({sub:'query',values:{document},positionals:['PAGE12']},options)).rejects.toThrow();expect(writes).toBe(0);
  await expect(graphqlCommand({sub:'mutate',values:{document},positionals:['PAGE12']},options)).rejects.toMatchObject({code:'outcome_unknown',exit:5});expect(writes).toBe(1);
  await writeFile(document,'mutation { unknownField }');await expect(graphqlCommand({sub:'mutate',values:{document},positionals:['PAGE12']},options)).rejects.toMatchObject({code:'graphql_validation'});expect(writes).toBe(1);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('uses private origin-bound login challenges and saves grants without exposing secrets',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {authCommand}=await import('../../../skills/artifactbin/scripts/auth.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'author-auth-')),codeFile=path.join(root,'code.txt'),server='https://example.test';
 try{
  const options={env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_HOME:root},fetcher:async(url:any,init:any)=>{const pathname=new URL(url).pathname;if(pathname.endsWith('send-verification-otp'))return Response.json({success:true});if(pathname.endsWith('sign-in/email-otp'))return Response.json({user:{id:'fixture'}},{headers:{'set-cookie':'session=synthetic; HttpOnly'}});expect(new Headers(init.headers).get('Cookie')).toBe('session=synthetic');return Response.json({access_token:'synthetic_access',refresh_token:'synthetic_refresh',client_id:'fixture_client',expires_in:3600});}};
  const challenge=await authCommand({sub:'login',values:{email:'author@example.test'},positionals:[]},options);expect(challenge.challenge).toBeTruthy();await writeFile(codeFile,'123456');
  const result=await authCommand({sub:'login',values:{challenge:challenge.challenge,'code-file':codeFile},positionals:[]},options);expect(JSON.stringify(result)).not.toContain('synthetic_access');
  expect(await authCommand({sub:'status',values:{},positionals:[]},options)).toMatchObject({authenticated:true,source:'private-store'});
  expect(await authCommand({sub:'logout',values:{},positionals:[]},options)).toMatchObject({localGrantRemoved:true,serverRevoked:false});
  expect(await authCommand({sub:'status',values:{},positionals:[]},options)).toMatchObject({authenticated:false});
 }finally{await rm(root,{recursive:true,force:true});}
});
it('distinguishes confirmed receipt persistence failure from unknown transport failure',async()=>{
 const {mkdtemp,mkdir,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {makeClient,createJournal,journalIntent,resumeJournal}=await import('../../../skills/artifactbin/scripts/toolbox-client.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'author-receipt-')),server='https://example.test';
 try{
  const journal=await createJournal(journalIntent({server,method:'POST',path:'/api/artifacts',body:{html:'<h1>Fixture</h1>'},operation:'publish'}),{root});
  await mkdir(journal+'.receipt.json');
  const client=makeClient(server,{env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'synthetic'},fetcher:async()=>Response.json({id:'PAGE12',version:1})});
  await expect(resumeJournal(journal,client,'publish')).rejects.toMatchObject({code:'receipt_save_failed',exit:1,details:{committed:true,id:'PAGE12',journal}});
 }finally{await rm(root,{recursive:true,force:true});}
});
it('refuses lossy dataset file extensions and writes canonical JSON with its observed baseline',async()=>{
 const {mkdtemp,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {readCommand}=await import('../../../skills/artifactbin/scripts/read.mjs');const root=await mkdtemp(path.join(tmpdir(),'author-data-read-'));
 try{
  const options={env:{ARTIFACTBIN_URL:'https://example.test',ARTIFACTBIN_TOKEN:'synthetic'},fetcher:async()=>Response.json({id:'DATA12',format:'dataset',version:3,state:'a'.repeat(64),rows:[{count:2}]})};
  await expect(readCommand({values:{output:path.join(root,'data.csv')},positionals:['DATA12']},options)).rejects.toMatchObject({code:'dataset_output_extension'});
  const pair=await readCommand({values:{output:path.join(root,'data.json')},positionals:['DATA12']},options);expect(JSON.parse(await readFile(pair.source,'utf8'))).toEqual([{count:2}]);expect(JSON.parse(await readFile(pair.baseline,'utf8'))).toMatchObject({id:'DATA12',version:3,state:'a'.repeat(64)});
 }finally{await rm(root,{recursive:true,force:true});}
});
it('keeps --json read output as canonical HTML with a matching baseline',async()=>{
 const {mkdtemp,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {readCommand}=await import('../../../skills/artifactbin/scripts/read.mjs');const root=await mkdtemp(path.join(tmpdir(),'author-html-read-'));
 try{
  const html='<html><body><h1 data-af-id="heading">Canonical</h1></body></html>';
  const result=await readCommand({values:{output:path.join(root,'page.html'),json:true},positionals:['PAGE12']},{env:{ARTIFACTBIN_URL:'https://example.test',ARTIFACTBIN_TOKEN:'synthetic'},fetcher:async()=>Response.json({id:'PAGE12',format:'html',version:3,state:'a'.repeat(64),html})});
  expect(await readFile(result.source,'utf8')).toContain(html);
  expect(JSON.parse(await readFile(result.baseline,'utf8'))).toMatchObject({id:'PAGE12',version:3,state:'a'.repeat(64),sourceFile:'page.html'});
  expect(result.outputOwned).toBe(true);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('summarizes a saved check per viewport so the file need not be reopened',async()=>{
 const {checkDigest}=await import('../../../skills/artifactbin/scripts/toolbox-client.mjs');
 const viewport={width:390,height:844},clean={pageErrors:[],consoleErrors:[],failedRequests:[],httpErrors:[]};
 const passed=checkDigest({ok:true,code:'completed',smokePassed:true,checks:[{viewport,...clean,overflow:{viewport:390,content:390,fits:true},contrast:{checked:12,belowAA:0,unreadable:0,low:[]},steps:true,task:{total:42},screenshot:{path:'/tmp/390x844.png'}}],unverified:['visual appearance']},'qa.json');
 expect(passed).toMatch(/full result qa\.json/);
 expect(passed).toMatch(/390x844: no errors; fits; contrast ok; task \{"total":42\}/);
 expect(passed).toMatch(/unverified: visual appearance/);
 // Screenshot paths stay in the saved file; agents without image input otherwise try to open them.
 expect(passed).not.toContain('/tmp/390x844.png');
 // Only a fully clean pass tells the author they may stop.
 expect(passed).toMatch(/clean pass: .*stop/);
 const failed=checkDigest({ok:false,code:'check_failed',smokePassed:false,checks:[{viewport,...clean,pageErrors:['boom'],overflow:{viewport:390,content:512,fits:false},contrast:{checked:9,belowAA:2,unreadable:1,low:[{text:'Stop the loss',ratio:1.01,need:3}]},error:'Expected 7 labels'},{error:'session closed'}]},'qa.json');
 expect(failed).toContain('check check_failed: smoke failed');
 expect(failed).toMatch(/pageErrors 1: boom; overflow 512>390; contrast 2 below AA \(1 under 2:1; 1\.01:1 "Stop the loss".*\); task error: Expected 7 labels/);
 expect(failed).toContain('  session closed');
 // An overflow names the element that sticks out.
 const wide=checkDigest({ok:false,code:'check_failed',smokePassed:false,checks:[{viewport,...clean,overflow:{viewport:390,content:416,fits:false,culprits:[{element:'div.table-wrap',right:416}]}}]},'qa.json');
 expect(wide).toMatch(/overflow 416>390\b.*div\.table-wrap/);
 const deck=checkDigest({ok:true,code:'completed',smokePassed:true,checks:[{viewport:{width:1200,height:630},...clean,overflow:{viewport:1200,content:1200,fits:true},contrast:{checked:30,belowAA:0,unreadable:0,low:[]},slides:{count:8,clipped:2,items:[{slide:8,text:'7.5k',px:53,by:'div.milestones'}],overlapping:1,overlaps:[{slide:2,text:'02',over:'Header label'}]}}]},'qa.json');
 expect(deck).toMatch(/slides 8 exportable, 2 clipped \(slide 8 "7\.5k" by div\.milestones 53px.*\), 1 overlapping \(slide 2 "02" over "Header label"\)/);
 // Every listed defect appears, not only the first, so one fix round covers them.
 const many=checkDigest({ok:true,code:'completed',smokePassed:true,checks:[{viewport:{width:390,height:844},...clean,overflow:{viewport:390,content:390,fits:true},contrast:{checked:9,belowAA:2,unreadable:0,low:[{text:'Ask',ratio:2.98,need:4.5,color:'rgb(240, 78, 56)'},{text:'Seed',ratio:3.1,need:4.5}]},slides:{count:8,clipped:2,items:[{slide:4,text:'2025',px:2,by:'svg'},{slide:5,text:'0.0',px:18,by:'svg'}],overlapping:0,overlaps:[]}}]},'qa.json');
 for(const text of ['"Ask"','rgb(240, 78, 56)','"Seed"','slide 4 "2025"','slide 5 "0.0"'])expect(many).toContain(text);
 expect(passed).not.toContain('slides');
 expect(failed).not.toContain('clean pass');
 expect(deck).not.toContain('clean pass');
 // A check without steps never reads as a clean pass; it asks for steps.
 expect(deck).toMatch(/--steps/);
});
it('replies without --expected-revision but still requires it to resolve or edit',async()=>{
 const {mkdtemp,rm,writeFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {commentCommand}=await import('../../../skills/artifactbin/scripts/comment.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'author-reply-')),calls:any[]=[],file=path.join(root,'body.md');await writeFile(file,'Thanks');
 const options={env:{ARTIFACTBIN_URL:'https://example.test',ARTIFACTBIN_TOKEN:'synthetic',ARTIFACTBIN_HOME:root},fetcher:async(url:any,init:any)=>{calls.push({url:String(url),...init});return Response.json({id:'ann_root',revision:2,thread:[]});}};
 try{
  await commentCommand({sub:'reply',values:{thread:'ann_root','body-file':file},positionals:['PAGE12']},options);
  expect(calls[0].url).toBe('https://example.test/api/artifacts/PAGE12/annotations/ann_root');expect(JSON.parse(calls[0].body)).toEqual({reply:'Thanks'});
  await expect(commentCommand({sub:'reply',values:{thread:'ann_root','body-file':file,resolve:true},positionals:['PAGE12']},options)).rejects.toThrow();
  await expect(commentCommand({sub:'resolve',values:{thread:'ann_root'},positionals:['PAGE12']},options)).rejects.toThrow();
  await commentCommand({sub:'reply',values:{thread:'ann_root','body-file':file,resolve:true,'expected-revision':'3'},positionals:['PAGE12']},options);
  expect(JSON.parse(calls[1].body)).toEqual({reply:'Thanks',expected_revision:3,resolve:true});expect(calls).toHaveLength(2);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('retries a keyed comment write through 502/503 with one key, and never retries a 409',async()=>{
 const {mkdtemp,rm,writeFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {commentCommand}=await import('../../../skills/artifactbin/scripts/comment.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'author-retry-')),file=path.join(root,'body.md');await writeFile(file,'Thanks');
 const run=async(...answers:Array<number|Error>)=>{
  const calls:any[]=[];const queue=[...answers];
  const fetcher=async(url:any,init:any)=>{calls.push({url:String(url),...init});const next=queue.length>1?queue.shift()!:queue[0]!;if(next instanceof Error)throw next;return next===200?Response.json({id:'ann_root',revision:2,thread:[]}):Response.json({error:next===409?'annotation_conflict':'unavailable'},{status:next});};
  const options={env:{ARTIFACTBIN_URL:'https://example.test',ARTIFACTBIN_TOKEN:'synthetic',ARTIFACTBIN_HOME:root},fetcher,retryDelays:[0,0,0]};
  const outcome=await commentCommand({sub:'reply',values:{thread:'ann_root','body-file':file,'expected-revision':'1'},positionals:['PAGE12']},options).then(()=>'ok',(error:any)=>error.code);
  return {calls,outcome};
 };
 try{
  const ok=await run(502,new TypeError('down'),503,200);
  expect(ok.outcome).toBe('ok');expect(ok.calls).toHaveLength(4);
  expect(new Set(ok.calls.map(call=>call.headers['Idempotency-Key'])).size).toBe(1);expect(ok.calls[0].headers['Idempotency-Key']).toBeTruthy();
  const conflict=await run(409,200);expect(conflict.calls).toHaveLength(1);expect(conflict.outcome).toBe('annotation_conflict');
  const exhausted=await run(502);expect(exhausted.calls).toHaveLength(4);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('sets independent desired comment reaction state and replays the exact intent',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {commentCommand}=await import('../../../skills/artifactbin/scripts/comment.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'author-reaction-')),calls:any[]=[];
 const options={env:{ARTIFACTBIN_URL:'https://example.test',ARTIFACTBIN_TOKEN:'synthetic',ARTIFACTBIN_HOME:root},fetcher:async(url:any,init:any)=>{calls.push({url:String(url),...init});return Response.json({id:'ann_root',thread:[{id:'ann_reply',reactions:[{kind:'thumbs_up',count:1,viewer_reacted:true}]}]});}};
 try{
  const result=await commentCommand({sub:'react',values:{comment:'ann_reply',active:'true'},positionals:['PAGE12']},options);
  expect(calls[0].url).toBe('https://example.test/api/artifacts/PAGE12/annotations/ann_reply/reactions');expect(calls[0].method).toBe('PUT');expect(JSON.parse(calls[0].body)).toEqual({kind:'thumbs_up',active:true});
  await commentCommand({sub:'react',values:{resume:result.journal},positionals:[]},options);
  expect(calls[1].body).toBe(calls[0].body);expect(calls[1].headers['Idempotency-Key']).toBe(calls[0].headers['Idempotency-Key']);
  await expect(commentCommand({sub:'react',values:{comment:'ann_reply',active:'true',kind:'heart'},positionals:['PAGE12']},options)).rejects.toThrow();expect(calls).toHaveLength(2);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('autofix.mjs fixes in place, --dry-run writes nothing, and the report starts with autofix:',async()=>{
 const {mkdtemp,readFile,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {autofixCommand}=await import('../../../skills/artifactbin/scripts/autofix.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'author-autofix-'));
 try{
  const file=path.join(root,'index.html'),source='<!doctype html><html><head><title>T</title></head><body><h1>Hi</h1><script defer src="/af/v1/core.js"></script></body></html>';
  await writeFile(file,source);const logs:string[]=[];const log=(text:string)=>{logs.push(text);};
  await autofixCommand({values:{'dry-run':true},positionals:[file]},{log});
  expect(await readFile(file,'utf8')).toBe(source);expect(logs[0]).toMatch(/^autofix: 3 to fix/);expect(logs[0]).toContain('dry run; nothing written');
  const json=await autofixCommand({values:{json:true},positionals:[file]},{log});
  expect(json).toMatchObject({written:true,clean:false});expect(json!.fixes.map((fix:any)=>fix.rule)).toEqual(['core-script','charset','viewport']);
  const fixed=await readFile(file,'utf8');expect(fixed).toContain('<meta charset="utf-8">');expect(fixed.match(/core\.js/g)).toHaveLength(1);
  await autofixCommand({values:{},positionals:[file]},{log});expect(logs.at(-1)).toMatch(/^autofix: clean/);expect(await readFile(file,'utf8')).toBe(fixed);
  await writeFile(file,fixed.replace('<h1>Hi</h1>','<img src="./missing.png">'));process.exitCode=undefined;
  await autofixCommand({values:{},positionals:[file]},{log});expect(logs.at(-1)).toMatch(/refused index\.html:\d+:\d+ local file not found: \.\/missing\.png/);expect(process.exitCode).toBe(1);process.exitCode=undefined;
 }finally{await rm(root,{recursive:true,force:true});}
});
it('serve runs autofix on the served bytes and leaves the file alone unless asked to write',async()=>{
 const {mkdtemp,readFile,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const startPreview=(await import('../../../skills/artifactbin/scripts/preview.mjs')).startPreview as (options:any)=>Promise<{url:string;close():Promise<void>}>;
 const root=await mkdtemp(path.join(tmpdir(),'author-serve-autofix-'));
 try{
  const file=path.join(root,'index.html'),source='<!doctype html><html><head><title>T</title></head><body><h1 id="x">Hi</h1><p id="x"></p></body></html>';await writeFile(file,source);
  const reports:string[]=[];const session=await startPreview({root,revisionIntervalMs:60000,autofix:{report:(text:string)=>reports.push(text)}});
  try{
   const served=await (await fetch(session.url)).text();
   expect(served).toContain('<meta charset="utf-8">');expect(served).toContain('name="viewport"');
   expect(await readFile(file,'utf8')).toBe(source);
   await fetch(session.url);expect(reports).toHaveLength(1);
   expect(reports[0]).toMatch(/^autofix: 2 fixed, 1 problem/);expect(reports[0]).toContain('served fixed; file unchanged (run autofix.mjs to write)');
   const findings=await (await fetch(new URL('/__af_preview/autofix?path=/',session.url))).json();
   expect(findings.problems).toEqual([expect.objectContaining({rule:'duplicate-id',line:1})]);
  }finally{await session.close();}
  const writing=await startPreview({root,revisionIntervalMs:60000,autofix:{write:true}});
  try{await fetch(writing.url);expect(await readFile(file,'utf8')).toContain('<meta charset="utf-8">');}finally{await writing.close();}
 }finally{await rm(root,{recursive:true,force:true});}
});
it('lists local autofix problems at the top of a saved check summary',async()=>{
 const {checkDigest}=await import('../../../skills/artifactbin/scripts/toolbox-client.mjs');
 const digest=checkDigest({ok:true,smokePassed:true,checks:[],autofix:{file:'/',problems:[{rule:'duplicate-id',line:4,column:2,message:'duplicate id "a" (first at line 3)'}]}},'qa.json');
 expect(digest.split('\n')[0]).toBe('autofix: 1 problem to fix by hand');expect(digest.split('\n')[1]).toContain(':4:2 duplicate id');expect(digest.split('\n')[2]).toMatch(/^check completed/);
});
it('summarizes duplicate and unstable data-af-id evidence without overstating either',async()=>{
 const {checkDigest}=await import('../../../skills/artifactbin/scripts/toolbox-client.mjs');
 const {summarizeCheck}=await import('../../../skills/artifactbin/scripts/check.mjs');
 const base={viewport:{width:1280,height:800},pageErrors:[],consoleErrors:[],httpErrors:[],failedRequests:[],telemetry:[],text:'Ready',overflow:{viewport:1280,content:1280,fits:true},contrast:{checked:1,belowAA:0,unreadable:0,low:[]},steps:true,task:{ok:true}};
 const dup={...base,ids:{total:4,duplicates:2,items:[{id:'budget-row-1',count:2},{id:'budget-row-2',count:3}]}};
 expect(summarizeCheck([dup]).smokePassed).toBe(false);
 const failed=checkDigest({ok:false,code:'check_failed',...summarizeCheck([dup])},'qa.json');
 expect(failed).toContain('budget-row-1');expect(failed).toContain('budget-row-2');expect(failed).not.toContain('clean pass');
 const unstable={...base,ids:{total:3,duplicates:0,items:[]},idStability:{checked:true,created:3,unstable:2,sample:['row-0.41','row-0.77']}};
 expect(summarizeCheck([unstable]).smokePassed).toBe(true);
 const warned=checkDigest({ok:true,...summarizeCheck([unstable])},'qa.json');
 expect(warned).toContain('row-0.41');expect(warned).toMatch(/warning/i);expect(warned).not.toContain('clean pass');
 const clean=checkDigest({ok:true,...summarizeCheck([{...base,ids:{total:3,duplicates:0,items:[]},idStability:{checked:false,created:0}}])},'qa.json');
 expect(clean).not.toMatch(/warning|duplicate/i);expect(clean).toContain('clean pass');
});
it('teaches script-created element IDs in the main steps and no longer names data-af="meta"',async()=>{
 const {readFile}=await import('node:fs/promises');
 const skill=await readFile(new URL('../../../skills/artifactbin/SKILL.md',import.meta.url),'utf8');
 expect(skill).not.toContain('data-af="meta"');
 for(const block of ['state','core','design-system'])expect(skill).toContain(`data-af="${block}"`);
 const steps=skill.slice(skill.indexOf('## Author and publish'),skill.indexOf('## Preserve the document'));
 expect(steps).toContain('afId');expect(steps).toContain('references/html-runtime.md#dynamic-elements-and-comments');
 const runtime=await readFile(new URL('../../../skills/artifactbin/references/html-runtime.md',import.meta.url),'utf8');
 expect(runtime).toContain('## Dynamic elements and comments');
});
