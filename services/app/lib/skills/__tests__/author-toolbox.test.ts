import {it,expect} from 'vitest';
it('binds targets to one origin and rejects target/server mismatches',async()=>{
 const {resolveTarget}=await import('../../../skills/artifactbin/scripts/toolbox-client.mjs');
 expect(resolveTarget('https://example.test/a/PAGE12','https://example.test')).toEqual({server:'https://example.test',id:'PAGE12'});
 expect(()=>resolveTarget('https://example.test/a/PAGE12','https://other.test')).toThrow();
 expect(()=>resolveTarget('https://user:secret@example.test/a/PAGE12')).toThrow();
});
it('counts an older page\'s /graphql post as a page call and reports its refusal like any other, with no GraphQL replay',async()=>{
 const {callKind,calls}=await import('../../../skills/artifactbin/scripts/toolbox-check-calls.mjs');
 expect(callKind('https://h.test/api/artifacts/PAGE12/graphql')).toEqual({kind:'graphql'});
 expect(callKind('https://h.test/api/artifacts/PAGE12/sql')).toEqual({kind:'sql'});
 expect(callKind('https://h.test/api/artifacts/PAGE12/fn/notes')).toEqual({kind:'fn',name:'notes'});
 expect(callKind('https://h.test/api/artifacts/PAGE12/annotations')).toBeNull();
 const response=(status:number,body:unknown)=>({url:()=>'https://h.test/api/artifacts/PAGE12/graphql',status:()=>status,json:async()=>body,
  request:()=>({postDataJSON:()=>({query:'query{sales{amount}}'}),method:()=>'POST'})});
 const into:any[]=[],waits:Promise<void>[]=[];
 // A 200 is not a refusal; a refused one keeps its status as the code and is never asked again.
 calls(response(200,{data:{sales:[]}}),{pageErrorsBefore:0},into,waits,callKind);
 calls(response(403,{errors:[{message:'denied'}]}),{pageErrorsBefore:0},into,waits,callKind);
 await Promise.all(waits);
 expect(into).toEqual([{field:'graphql',kind:'graphql',message:'http_403',code:'http_403',pageErrorsBefore:0}]);
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
it('flushes watch events before checkpoints, deduplicates replay and validates the log identity',async()=>{
 const {mkdtemp,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {watchComments}=await import('../../../skills/artifactbin/scripts/toolbox-comments.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'author-watch-')),output=path.join(root,'feed.ndjson'),server='https://example.test';
 const event={type:'artifactbin.comment',event_id:'e1',annotation_id:'A',author:{kind:'human',you:false},body:'Hi'};
 try{
  // Every page of the feed repeats e1; thread A stays open, so a resumed call stops on its owed answer.
  const afters:string[]=[];let calls=0;const client={server,request:async(route:string)=>{const url=new URL(route,server);if(url.pathname.endsWith('/annotations'))return {annotations:[{id:'A'}],next_cursor:null};
   afters.push(url.searchParams.get('after')!);calls++;return {events:[event],next_cursor:'opaque'+calls,has_more:calls===1};}};
  await watchComments(client,'PAGE12',{next:true,output},{deliver:async()=>{}});
  const records=(await readFile(output,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  expect(records.map(record=>record.kind)).toEqual(['watch','window','event','printed','checkpoint']);
  await watchComments(client,'PAGE12',{next:true,append:true,output},{deliver:async()=>{}});
  expect(afters).toEqual(['start','opaque1','opaque2']);
  expect((await readFile(output,'utf8')).match(/"kind":"event"/g)).toHaveLength(1);
  await expect(watchComments({...client,server:'https://other.test'},'PAGE12',{next:true,append:true,output})).rejects.toMatchObject({code:'log_mismatch'});
 }finally{await rm(root,{recursive:true,force:true});}
});
it('classifies unreadable successful write bodies as unknown without automatic replay',async()=>{
 const {makeClient}=await import('../../../skills/artifactbin/scripts/toolbox-client.mjs');
 for(const route of ['/api/artifacts','/api/artifacts/PAGE12/annotations','/api/artifacts/PAGE12/sql']){
  let calls=0;const client=makeClient('https://example.test',{env:{ARTIFACTBIN_URL:'https://example.test',ARTIFACTBIN_TOKEN:'synthetic'},fetcher:async()=>{calls++;return new Response('{"truncated":',{status:200});}});
  await expect(client.request(route,{method:'POST',body:{},unsafe:true})).rejects.toMatchObject({code:'outcome_unknown',exit:5});expect(calls).toBe(1);
 }
});
it('names what a version conflict changed and the one re-read step, and never claims a newer version for another 409',async()=>{
 const {makeClient}=await import('../../../skills/artifactbin/scripts/toolbox-client.mjs');
 const refused=(body:Record<string,unknown>)=>makeClient('https://example.test',{env:{ARTIFACTBIN_URL:'https://example.test',ARTIFACTBIN_TOKEN:'synthetic'},fetcher:async()=>Response.json(body,{status:409})}).request('/api/artifacts/PAGE12',{method:'PUT',body:{},unsafe:true}).catch((error:any)=>error);
 const step='since your read. Run read.mjs ID --output page.html, reapply your edits to that file and publish it; do not resume this journal.';
 expect(await refused({error:'version_conflict',currentVersion:4,changed:'content'})).toMatchObject({code:'version_conflict',exit:4,recovery:`A newer version was published ${step}`});
 expect(await refused({error:'version_conflict',currentVersion:3,changed:'details'})).toMatchObject({recovery:`The title, description or metadata changed ${step}`});
 const other=await refused({error:'policy_locked',detail:'owner only'});
 expect(other).toMatchObject({code:'policy_locked',exit:4});expect(other.recovery).not.toContain('version');expect(other.recovery).not.toContain('read.mjs');
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
  // One chart or section of the page, by CSS selector, alone or within a slide; never with the HTML copy.
  const chart=path.join(root,'chart.png');
  expect(await exportCommand({values:{format:'png',element:'#orders-chart',output:chart},positionals:['PAGE12']},options)).toMatchObject({width:390,height:844,outputOwned:true});
  expect(new URL(calls.at(-1).url).searchParams.get('element')).toBe('#orders-chart');
  await exportCommand({values:{format:'png',element:'.kpi',slide:'3',output:path.join(root,'kpi.png')},positionals:['PAGE12']},options);
  expect([...new URL(calls.at(-1).url).searchParams]).toEqual([['format','png'],['slide','3'],['element','.kpi']]);
  await expect(exportCommand({values:{format:'html',element:'#orders-chart',output:path.join(root,'copy.html')},positionals:['PAGE12']},options)).rejects.toMatchObject({code:'unsupported_element',exit:2});
  const {parseCommand}=await import('../../../skills/artifactbin/scripts/toolbox-commands.mjs');
  expect(parseCommand('export',['PAGE12','--format','png','--element','#orders-chart','--output','x.png']).values.element).toBe('#orders-chart');
 }finally{await rm(root,{recursive:true,force:true});}
});
it('answers every sql.mjs statement in the documented shape, through a page or a dataset, paging a dataset read up to --limit',async()=>{
 const {sqlCommand}=await import('../../../skills/artifactbin/scripts/sql.mjs');
 const sent:Array<{path:string;body?:any;key?:string|null}>=[];
 const rows=Array.from({length:250},(_,i)=>({n:i}));
 const options={env:{ARTIFACTBIN_URL:'https://example.test',ARTIFACTBIN_TOKEN:'synthetic'},fetcher:async(url:any,init:any)=>{
  const path=new URL(String(url)).pathname,body=init?.body?JSON.parse(String(init.body)):undefined;
  sent.push({path,body,key:new Headers(init?.headers).get('idempotency-key')});
  if(path==='/api/artifacts/PAGE12')return Response.json({id:'PAGE12',format:'html',version:3});
  if(path==='/api/artifacts/DATA12')return Response.json({id:'DATA12',format:'dataset',version:9});
  if(path==='/api/artifacts/PAGE12/sql')return Response.json(/^insert/.test(body.sql)?{affected:1,returning:[{_id:'r1',n:1}]}:{columns:[{name:'n',type:'number'}],rows});
  if(path==='/api/artifacts/DATA12/mutate')return Response.json({id:'DATA12',version:10,affected:2,rowCount:252});
  if(path==='/api/artifacts/DATA12/query'){
   // The dataset query door: at most 100 rows a page, the next page by cursor.
   const offset=body.cursor?Number(body.cursor):0,page=rows.slice(offset,offset+body.limit);
   return Response.json({results:[{id:'DATA12',name:'public.rows',columns:[{name:'n',type:'number'}],rows:page,totalRows:rows.length,next_cursor:offset+body.limit<rows.length?String(offset+body.limit):null}]});}
  return Response.json({error:'not_found'},{status:404});}};
 const run=(target:string,statement:string,values:Record<string,unknown>={}):Promise<any>=>sqlCommand({sub:'query',values,positionals:[target,statement]},options);
 // A page read: {columns, rows}, the head revision bound, --limit cutting it with truncated.
 expect(await run('PAGE12','select n from t',{limit:'2'})).toEqual({columns:[{name:'n',type:'number'}],rows:[{n:0},{n:1}],truncated:true});
 expect(sent.find(s=>s.path.endsWith('/sql'))!.body).toEqual({sql:'select n from t',params:{},revision:'3'});
 // A page write: {affected, returning} and the key that replays it.
 const wrote=await run('PAGE12','insert into t (n) values ($n)',{});
 expect(wrote).toMatchObject({affected:1,returning:[{_id:'r1',n:1}],idempotencyKey:expect.stringMatching(/^[a-f0-9]{32}$/)});
 expect(sent.at(-1)!.key).toBe(wrote.idempotencyKey);
 // A dataset read follows next_cursor (default 1000 rows) and answers {columns, rows}, never the door's {results}.
 sent.length=0;
 expect(await run('DATA12','select n from rows')).toEqual({columns:[{name:'n',type:'number'}],rows});
 expect(sent.filter(s=>s.path.endsWith('/query')).map(s=>[s.body.limit,s.body.cursor??null])).toEqual([[100,null],[100,'100'],[100,'200']]);
 const capped=await run('DATA12','select n from rows',{limit:'150'});
 expect(capped.rows).toHaveLength(150);expect(capped.truncated).toBe(true);
 // A dataset write: {affected, returning} (returning is empty: the door answers counts only).
 expect(await run('DATA12','delete from rows where n < 2')).toEqual({affected:2,returning:[],version:10});
 await expect(run('DATA12','select 1',{limit:'10001'})).rejects.toMatchObject({code:'invalid_limit',exit:2});
});
it('uses private origin-bound login challenges and saves grants without exposing secrets',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {authCommand}=await import('../../../skills/artifactbin/scripts/auth.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'author-auth-')),codeFile=path.join(root,'code.txt'),server='https://example.test';
 try{
  const options={env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_HOME:root},fetcher:async(url:any,init:any)=>{const pathname=new URL(url).pathname;if(pathname==='/oauth/revoke')return Response.json({});if(pathname.endsWith('send-verification-otp'))return Response.json({success:true});if(pathname.endsWith('sign-in/email-otp'))return Response.json({user:{id:'fixture'}},{headers:{'set-cookie':'session=synthetic; HttpOnly'}});expect(new Headers(init.headers).get('Cookie')).toBe('session=synthetic');return Response.json({access_token:'synthetic_access',refresh_token:'synthetic_refresh',client_id:'fixture_client',expires_in:3600});}};
  const challenge=await authCommand({sub:'login',values:{email:'author@example.test'},positionals:[]},options);expect(challenge.challenge).toBeTruthy();await writeFile(codeFile,'123456');
  const result=await authCommand({sub:'login',values:{challenge:challenge.challenge,'code-file':codeFile},positionals:[]},options);expect(JSON.stringify(result)).not.toContain('synthetic_access');
  expect(await authCommand({sub:'status',values:{},positionals:[]},options)).toMatchObject({authenticated:true,source:'private-store'});
  expect(await authCommand({sub:'logout',values:{},positionals:[]},options)).toMatchObject({localGrantRemoved:true,serverRevoked:true});
  expect(await authCommand({sub:'status',values:{},positionals:[]},options)).toMatchObject({authenticated:false});
 }finally{await rm(root,{recursive:true,force:true});}
});
it('status proves an unexpired saved grant with the server, so a grant revoked elsewhere reads as signed out',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {authCommand}=await import('../../../skills/artifactbin/scripts/auth.mjs'),{platform}=await import('../../../skills/artifactbin/scripts/toolbox-client.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'author-status-')),server='https://example.test';
 try{
  const shared=await platform();
  await shared.saveCredentials({server,token:'synthetic_access',refreshToken:'synthetic_refresh',clientId:'fixture_client',expiresAt:Date.now()+3600_000},root);
  let revoked=false;const refreshes:string[]=[];
  const options={env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_HOME:root},fetcher:async(url:any)=>{refreshes.push(new URL(url).pathname);return revoked?Response.json({error:'invalid_grant'},{status:400}):Response.json({access_token:'synthetic_access_2',refresh_token:'synthetic_refresh_2',client_id:'fixture_client',expires_in:3600});}};
  expect(await authCommand({sub:'status',values:{},positionals:[]},options)).toMatchObject({authenticated:true,source:'private-store',expired:false});
  expect(refreshes.length).toBe(1);
  revoked=true;
  expect(await authCommand({sub:'status',values:{},positionals:[]},options)).toMatchObject({authenticated:false,refresh:'refused'});
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
it('refuses lossy dataset file extensions and writes canonical JSON with nothing beside it',async()=>{
 const {mkdtemp,readFile,readdir,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {readCommand}=await import('../../../skills/artifactbin/scripts/read.mjs');const root=await mkdtemp(path.join(tmpdir(),'author-data-read-'));
 try{
  const options={env:{ARTIFACTBIN_URL:'https://example.test',ARTIFACTBIN_TOKEN:'synthetic'},fetcher:async()=>Response.json({id:'DATA12',format:'dataset',version:3,state:'a'.repeat(64),rows:[{count:2}]})};
  await expect(readCommand({values:{output:path.join(root,'data.csv')},positionals:['DATA12']},options)).rejects.toMatchObject({code:'dataset_output_extension'});
  const read=await readCommand({values:{output:path.join(root,'data.json')},positionals:['DATA12']},options);expect(JSON.parse(await readFile(read.source,'utf8'))).toEqual([{count:2}]);
  // The id lives in the printed update command, never in a file beside the data.
  expect(read.next).toBe('Next: to publish an edit of data.json over dataset DATA12: node scripts/publish.mjs data.json --artifact DATA12 (without --artifact a new dataset is created).');
  expect(await readdir(root)).toEqual(['data.json']);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('keeps --json read output as canonical HTML that carries its own marker',async()=>{
 const {mkdtemp,readFile,readdir,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path'),{createHash}=await import('node:crypto');
 const {readCommand}=await import('../../../skills/artifactbin/scripts/read.mjs');const root=await mkdtemp(path.join(tmpdir(),'author-html-read-'));
 const {sourceIdentity,stripMarker}=await import('../../../skills/artifactbin/scripts/toolbox-source.mjs');
 try{
  const html='<html><body><h1 data-af-id="heading">Canonical</h1></body></html>';
  const result=await readCommand({values:{output:path.join(root,'page.html'),json:true},positionals:['PAGE12']},{env:{ARTIFACTBIN_URL:'https://example.test',ARTIFACTBIN_TOKEN:'synthetic'},fetcher:async()=>Response.json({id:'PAGE12',format:'html',version:3,state:'a'.repeat(64),sharing_revision:2,html})});
  const saved=await readFile(result.source,'utf8');expect(saved).toContain(html);
  expect(sourceIdentity(saved)).toEqual({server:'https://example.test',id:'PAGE12',version:3,state:'a'.repeat(64),sha256:createHash('sha256').update(stripMarker(saved)).digest('hex'),entryPath:'page.html',sharingRevision:2});
  expect(result.outputOwned).toBe(true);expect(await readdir(root)).toEqual(['page.html']);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('summarizes a saved check per viewport so the file need not be reopened',async()=>{
 const {checkDigest}=await import('../../../skills/artifactbin/scripts/toolbox-client.mjs');
 const viewport={width:390,height:844},clean={pageErrors:[],consoleErrors:[],failedRequests:[],httpErrors:[]};
 const passed=checkDigest({ok:true,code:'completed',smokePassed:true,checks:[{viewport,...clean,overflow:{viewport:390,content:390,fits:true},contrast:{checked:12,belowAA:0,unreadable:0,low:[]},steps:true,task:{total:42},screenshot:{path:'/tmp/390x844.png'}}],unverified:['task behavior','persistence','permissions']},'qa.json');
 // A clean pass needs nothing from the saved JSON: only a failure names the file.
 expect(passed).not.toContain('full result');
 expect(passed).toMatch(/390x844: no errors; fits; contrast ok; task \{"total":42\}/);
 expect(passed).not.toContain('download started');
 // A step's link that downloaded a file says so on its viewport's line, by the file's name.
 const fetched=checkDigest({ok:true,code:'completed',smokePassed:true,checks:[{viewport,...clean,overflow:{viewport:390,content:390,fits:true},steps:{ran:true,passed:true},downloads:[{url:'https://doc.example/a/x/assets?dependency=y',file:'rota.pdf'}]}],unverified:[]},'qa.json');
 expect(fetched).toMatch(/390x844: no errors; fits; contrast unknown; steps passed; download started: rota\.pdf\n/);
 // No line sends the agent back to its screenshots after a clean pass ("Inspect task results
 // separately"): the facts say what is not tested, nothing more.
 expect(passed).toMatch(/unverified: task behavior, persistence, permissions/);
 expect(passed).not.toMatch(/visual acceptance|Inspect task results/);
 // The digest names the screenshots it saved (M7).
 expect(passed).toContain('  screenshots: /tmp/390x844.png');
 // A screenshot that is not the whole page says why next to its path.
 const tall=checkDigest({ok:true,code:'completed',smokePassed:true,checks:[{viewport,...clean,overflow:{viewport:390,content:390,fits:true},screenshot:{path:'/tmp/390x844.png',height:8000,partial:'capped at 8000 px'}}],unverified:[]},'qa.json');
 expect(tall).toContain('  screenshots: /tmp/390x844.png (capped at 8000 px)');
 // A deck's slides are listed as the files they are, with their size and why any are missing.
 const slideShots=(partial?:string)=>checkDigest({ok:true,code:'completed',smokePassed:true,checks:[{viewport,...clean,overflow:{viewport:390,content:390,fits:true},screenshot:{path:'/tmp/1200x630.png',slides:[1,2].map(n=>({path:`/tmp/1200x630-slide-${n}.png`,width:1200,height:630})),...(partial?{slidesPartial:partial}:{})}}],unverified:[]},'qa.json');
 expect(slideShots()).toContain('  slides, one PNG per slide at 1200x630 (these files are the slides): /tmp/1200x630-slide-1.png, /tmp/1200x630-slide-2.png\n');
 expect(slideShots('first 20 of 24 slides')).toContain(' at 1200x630 (these files are the slides; first 20 of 24 slides): /tmp/1200x630-slide-1.png');
 expect(passed).not.toContain('slides, one PNG');
 // A clean pass of a published page ends with the reply facts and the watch line; this envelope has none (a local preview).
 expect(passed).toContain('clean pass on the local preview; a check of the published page prints the facts for your reply.');
 expect(passed).not.toMatch(/until the user stops|Verified:|For your reply:/);
 const failed=checkDigest({ok:false,code:'check_failed',smokePassed:false,checks:[{viewport,...clean,pageErrors:['boom'],overflow:{viewport:390,content:512,fits:false},contrast:{checked:9,belowAA:2,unreadable:1,low:[{text:'Stop the loss',ratio:1.01,need:3}]},error:'Expected 7 labels'},{error:'session closed'}]},'qa.json');
 expect(failed).toContain('check check_failed: smoke failed; full result qa.json');
 expect(failed).toMatch(/pageErrors 1: boom; overflow 512>390; contrast 2 below AA \(1 under 2:1; 1\.01:1 "Stop the loss".*\); task error: Expected 7 labels/);
 expect(failed).toContain('  session closed');
 // A guest run is labelled; a clean deck pass lists its slide images.
 const reply={id:'X',link:'https://h/a/X',builtWith:'one HTML page; Vega-Lite charts',permissions:[{id:'DATA12',name:'targets',lines:['Table public.targets','- Owner, editors: see and change everything.']}]};
 const guestDeck=checkDigest({ok:true,code:'completed',smokePassed:true,reply,slideLinks:['https://h/a/X/export?format=png&slide=1'],checks:[{viewport,...clean,overflow:{viewport:390,content:390,fits:true},contrast:{checked:1,belowAA:0,unreadable:0,low:[]},steps:true,task:{}},{viewport,viewer:'guest',...clean,overflow:{viewport:390,content:390,fits:true},contrast:{checked:1,belowAA:0,unreadable:0,low:[]},steps:true,task:{}}]},'qa.json');
 expect(guestDeck).toContain('  guest 390x844:');expect(guestDeck).toContain("  clean pass: nothing left to fix.\nFor your reply:\nLink: https://h/a/X\n");expect(guestDeck).toContain('\nSlide images:\nhttps://h/a/X/export?format=png&slide=1\n');expect(guestDeck).not.toMatch(/curl|qa JSON/);
 // A passing run lists exactly the step labels it proved, per viewport, and what it did not, in one facts section (H10/H11).
 const proved=checkDigest({ok:true,code:'completed',smokePassed:true,reply,checks:[{viewport,...clean,overflow:{viewport:390,content:390,fits:true},contrast:{checked:1,belowAA:0,unreadable:0,low:[]},steps:{ran:true,passed:true},verified:['target saves']},{viewport,viewer:'guest',...clean,overflow:{viewport:390,content:390,fits:true},contrast:{checked:1,belowAA:0,unreadable:0,low:[]},steps:{ran:true,passed:true},verified:['guest reads it']}]},'qa.json');
 expect(proved).not.toContain('Verified');
 expect(proved.slice(proved.indexOf('For your reply:'))).toBe(['For your reply:','Link: https://h/a/X','Built with: one HTML page; Vega-Lite charts','Tested: 390x844: target saves | guest 390x844: guest reads it','Not tested: visual appearance; sharing between two signed-in users (the guest is signed out)','Who can do what:','Table public.targets','- Owner, editors: see and change everything.','','Next: when the request is done, reply to the user (use the facts above for testing, build and permissions) and run the comment watch, even when the reply is only the link. Nothing may hold back your reply: it is every link the user asked for, in the form they asked for (a page\'s public view is its receipt\'s user_page_url), plus what they asked. The watch waits only once that reply is sent: its first call after you publish, edit or comment returns at once, and so does every call until one adds --replied, which you add only after sending the reply. Claude Code: start the watch, one per page, with the Bash tool\'s run_in_background first, then send your reply as your last message and end your turn; when that first call wakes you, start it again with --replied the same way. Other harnesses: say your reply to the user, then call the watch in the foreground with its default wait and a shell timeout of at least 300000 ms, then once more with --replied; several pages share each call (node scripts/comment.mjs watch A --next --replied & node scripts/comment.mjs watch B --next --replied & wait). Once waiting, it returns as soon as someone comments, and on its own within 4 minutes: handle what it printed and run it again until it says to stop watching. Watching follows every task, however short the reply.\n  node scripts/comment.mjs watch X --next',''].join('\n'));
 // Steps that proved no labelled behaviour still leave a true Tested: line, never an empty one.
 const bare=checkDigest({ok:true,code:'completed',smokePassed:true,reply,checks:[{viewport,...clean,overflow:{viewport:390,content:390,fits:true},contrast:{checked:1,belowAA:0,unreadable:0,low:[]},steps:{ran:true,passed:true}}]},'qa.json');
 expect(bare).toContain('\nTested: 390x844: the page loads without errors\n');expect(bare).not.toMatch(/Tested: \n/);
 // Several linked datasets each name themselves before their read-back lines.
 const two=checkDigest({ok:true,smokePassed:true,reply:{...reply,permissions:[...reply.permissions,{id:'DATA34',name:'rows',lines:['Table public.rows']}]},checks:[{viewport,...clean,overflow:{viewport:390,content:390,fits:true},contrast:{checked:1,belowAA:0,unreadable:0,low:[]},steps:true,verified:['a']}]});
 expect(two).toContain('Who can do what:\ntargets (ref:DATA12):\nTable public.targets\n- Owner, editors: see and change everything.\nrows (ref:DATA34):\nTable public.rows\n\nNext:');expect(two).toContain('check completed: smoke passed\n');
 // A failed or flawed run points at the summary itself, as a pass does.
 expect(failed).toContain('fix what is named above, then run the check again.');expect(passed).not.toContain('fix what is named');
 // An overflow names the element that sticks out.
 const wide=checkDigest({ok:false,code:'check_failed',smokePassed:false,checks:[{viewport,...clean,overflow:{viewport:390,content:416,fits:false,culprits:[{element:'div.table-wrap',right:416}]}}]},'qa.json');
 expect(wide).toMatch(/overflow 416>390\b.*div\.table-wrap/);
 const deck=checkDigest({ok:true,code:'completed',smokePassed:true,checks:[{viewport:{width:1200,height:630},...clean,overflow:{viewport:1200,content:1200,fits:true},contrast:{checked:30,belowAA:0,unreadable:0,low:[]},slides:{count:8,clipped:2,items:[{slide:8,text:'7.5k',px:53,by:'div.milestones'}],overlapping:1,overlaps:[{slide:2,text:'02',over:'Header label'}]}}]},'qa.json');
 expect(deck).toMatch(/slides 8 exportable, 2 clipped \(slide 8 "7\.5k" by div\.milestones 53px.*\), 1 overlapping \(slide 2 "02" over "Header label"\)/);
 // Every listed defect appears, not only the first, so one fix round covers them.
 const many=checkDigest({ok:true,code:'completed',smokePassed:true,checks:[{viewport:{width:390,height:844},...clean,overflow:{viewport:390,content:390,fits:true},contrast:{checked:9,belowAA:2,unreadable:0,low:[{text:'Ask',ratio:2.98,need:4.5,color:'rgb(240, 78, 56)'},{text:'Seed',ratio:3.1,need:4.5}]},slides:{count:8,clipped:2,items:[{slide:4,text:'2025',px:2,by:'svg'},{slide:5,text:'0.0',px:18,by:'svg'}],overlapping:0,overlaps:[]}}]},'qa.json');
 for(const text of ['"Ask"','rgb(240, 78, 56)','"Seed"','slide 4 "2025"','slide 5 "0.0"'])expect(many).toContain(text);
 // Contrast items name the element and slide; each kind lists up to twelve, then a count; assertions print in full.
 const labels=[...'ABCDEFGHIJKLMN'],assertion='relationship between market size and the illustrative serviceable share is labelled '.repeat(4);
 const named=checkDigest({ok:true,code:'completed',smokePassed:true,checks:[{viewport:{width:1200,height:630},...clean,overflow:{viewport:1200,content:1200,fits:true},contrast:{checked:20,belowAA:14,unreadable:0,low:labels.map(text=>({text,ratio:3.18,need:4.5,element:'p.foot',slide:8}))},steps:{ran:true,passed:true},task:{assertions:[assertion]}}]},'qa.json');
 expect(named).toContain('3.18:1 "A" p.foot slide 8');expect(named).toContain('"L"');expect(named).not.toContain('"M"');expect(named).toContain('+2 more');expect(named).toContain(assertion.trim());
 expect(passed).not.toContain('slides');
 expect(failed).not.toContain('clean pass');
 expect(deck).not.toContain('clean pass');
 // A check without steps never reads as a clean pass; it asks for steps.
 expect(deck).toMatch(/--steps/);
});
it('names the missing module when an install is incomplete',async()=>{
 const {toolFailure}=await import('../../../skills/artifactbin/scripts/toolbox-client.mjs');
 const error=Object.assign(Error("Cannot find module '/skills/artifactbin/scripts/toolbox-platform.mjs' imported from /skills/artifactbin/scripts/check.mjs"),{code:'ERR_MODULE_NOT_FOUND'});
 expect(toolFailure('check',error)).toMatchObject({ok:false,code:'ERR_MODULE_NOT_FOUND',message:'Missing module /skills/artifactbin/scripts/toolbox-platform.mjs: the skill install is incomplete.'});
});
it('checks a published file by the page its marker names and refuses an unpublished one',async()=>{
 const {mkdtemp,rm,writeFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {checkCommand}=await import('../../../skills/artifactbin/scripts/check.mjs');
 const {stampSource}=await import('../../../skills/artifactbin/scripts/toolbox-source.mjs');
 const dir=await mkdtemp(path.join(tmpdir(),'check-file-'));
 try{
  const file=path.join(dir,'index.html');await writeFile(file,'<p>Hi</p>');
  await expect(checkCommand({values:{},positionals:[file]},{env:{}})).rejects.toMatchObject({code:'unpublished_file',recovery:expect.stringContaining(`node scripts/publish.mjs ${file} --create`)});
  await writeFile(file,stampSource('<p>Hi</p>',{server:'https://pages.example',id:'PAGE12',version:1,state:'a'.repeat(64),sha256:'b'.repeat(64),entryPath:'index.html'}));
  // The marker supplies id and server, so the hosted request goes to that server for /a/PAGE12.
  const seen:string[]=[];
  await checkCommand({values:{},positionals:[file]},{env:{ARTIFACTBIN_URL:'https://pages.example',ARTIFACTBIN_TOKEN:'t'},retryDelays:[],fetcher:async(input:any,init:any)=>{seen.push(String(input)+' '+(init?.body??''));throw Error('stop');}}).catch(error=>seen.push('error '+error.message));
  expect(seen.some(entry=>entry.startsWith('https://pages.example/api/browser-sessions')&&entry.includes('/a/PAGE12'))).toBe(true);
 }finally{await rm(dir,{recursive:true,force:true});}
});
it('replies with text alone, and a resolve without --expected-revision reads the thread revision first',async()=>{
 const {mkdtemp,rm,writeFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {commentCommand}=await import('../../../skills/artifactbin/scripts/comment.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'author-reply-')),calls:any[]=[],file=path.join(root,'body.md');await writeFile(file,'Thanks');
 const options={env:{ARTIFACTBIN_URL:'https://example.test',ARTIFACTBIN_TOKEN:'synthetic',ARTIFACTBIN_HOME:root},fetcher:async(url:any,init:any)=>{calls.push({url:String(url),...init});
  return Response.json((init?.method??'GET')==='GET'?{annotations:[{id:'ann_root',revision:2,thread:[{id:'ann_root'}]}],next_cursor:null}:{id:'ann_root',revision:3,thread:[]});}};
 try{
  await commentCommand({sub:'reply',values:{thread:'ann_root','body-file':file},positionals:['PAGE12']},options);
  expect(calls[0].url).toBe('https://example.test/api/artifacts/PAGE12/annotations/ann_root');expect(JSON.parse(calls[0].body)).toEqual({reply:'Thanks'});
  await commentCommand({sub:'reply',values:{thread:'ann_root','body-file':file,resolve:true},positionals:['PAGE12']},options);
  expect(calls[1].url).toMatch(/\/api\/artifacts\/PAGE12\/annotations\?status=all/);expect(JSON.parse(calls[2].body)).toEqual({reply:'Thanks',expected_revision:2,resolve:true});
  await commentCommand({sub:'reply',values:{thread:'ann_root','body-file':file,resolve:true,'expected-revision':'3'},positionals:['PAGE12']},options);
  expect(JSON.parse(calls[3].body)).toEqual({reply:'Thanks',expected_revision:3,resolve:true});expect(calls).toHaveLength(4);
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
  const file=path.join(root,'index.html'),source='<!doctype html><html><head><title>T</title></head><body><h1>Hi</h1><script defer src="/af/core.js"></script></body></html>';
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
 const startPreview=(await import('../../../skills/artifactbin/scripts/preview-server.mjs')).startPreview as (options:any)=>Promise<{url:string;close():Promise<void>}>;
 const root=await mkdtemp(path.join(tmpdir(),'author-serve-autofix-'));
 try{
  const file=path.join(root,'index.html'),source='<!doctype html><html><head><title>T</title></head><body><h1 id="x">Hi</h1><p id="x"></p></body></html>';await writeFile(file,source);
  const reports:string[]=[];const session=await startPreview({root,revisionIntervalMs:60000,autofix:{report:(text:string)=>reports.push(text)}});
  try{
   const served=await (await fetch(session.url)).text();
   expect(served).toContain('<meta charset="utf-8">');expect(served).toContain('name="viewport"');
   expect(await readFile(file,'utf8')).toBe(source);
   await fetch(session.url);expect(reports).toHaveLength(1);
   expect(reports[0]).toMatch(/^autofix: 2 fixed, 1 warning/);expect(reports[0]).toContain('served fixed; file unchanged (run autofix.mjs to write)');
   const findings=await (await fetch(new URL('/__af_preview/autofix?path=/',session.url))).json();
   expect(findings.problems).toEqual([]);expect(findings.warnings).toEqual([expect.objectContaining({rule:'duplicate-id',line:1})]);
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
it('teaches script-created element IDs once, in runtime.md, linked from SKILL.md, and no longer names data-af="meta"',async()=>{
 const {readFile}=await import('node:fs/promises');
 const skill=await readFile(new URL('../../../skills/artifactbin/SKILL.md',import.meta.url),'utf8');
 expect(skill).not.toContain('data-af="meta"');
 expect(skill).toContain('data-af="state"');
 expect(skill).toContain('artifactbin:design-system');
 // One data-af-id rule (rulings H8): SKILL.md links it and restates none of it.
 expect(skill).toContain('references/runtime.md#dynamic-elements-and-comments');expect(skill).not.toContain('afId');
 const runtime=await readFile(new URL('../../../skills/artifactbin/references/runtime.md',import.meta.url),'utf8');
 expect(runtime).toContain('## Dynamic elements and comments');expect(runtime).toContain('`<list>-<record id>-<role>`');
 expect(runtime).toContain("item.dataset.afId='garden-job-'+job.id;");
});
it('publish --group resolves the group first and sends an explicit destination only when you can edit it',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {publishCommand}=await import('../../../skills/artifactbin/scripts/toolbox-publish.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'publish-group-')),server='https://example.test';
 try{
  const file=path.join(root,'index.html');await writeFile(file,'<!doctype html><html><head><meta charset="utf-8"><title>T</title></head><body><h1>Hi</h1></body></html>');
  const seen:string[]=[];let role='editor';
  const fetcher=async(url:any)=>{seen.push(new URL(String(url)).pathname);return Response.json({group:{id:'grp_team',handle:'team',role}});};
  const options={env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'private-fixture',ARTIFACTBIN_HOME:root},fetcher,log:()=>{}};
  const planned=await publishCommand({values:{server,'dry-run':true,group:'@team',create:true},positionals:[file]},options);
  expect(seen).toEqual(['/api/groups/team']);expect(planned).toMatchObject({dryRun:true,method:'POST',destination:{type:'group',id:'grp_team'}});
  expect(await publishCommand({values:{server,'dry-run':true,create:true},positionals:[file]},options)).not.toHaveProperty('destination');
  expect(await publishCommand({values:{server,'dry-run':true,personal:true,create:true},positionals:[file]},options)).toMatchObject({destination:{type:'personal'}});
  await expect(publishCommand({values:{server,'dry-run':true,personal:true,group:'team'},positionals:[file]},options)).rejects.toMatchObject({code:'invalid_destination'});
  role='viewer';
  await expect(publishCommand({values:{server,'dry-run':true,group:'team',create:true},positionals:[file]},options)).rejects.toMatchObject({code:'group_not_editor'});
 }finally{await rm(root,{recursive:true,force:true});}
});
it('exports the same DESCRIPTION the registry reads, from each real script',async()=>{
 const {COMMANDS}=await import('../../../skills/artifactbin/scripts/toolbox-commands.mjs');
 const {descriptionOf}=await import('../../../skills/artifactbin/scripts/toolbox-description.mjs');
 for(const name of Object.keys(COMMANDS)){
  const module=await import(`../../../skills/artifactbin/scripts/${name}.mjs`);
  expect(module.DESCRIPTION,name).toBe(descriptionOf(name));
 }
});
it('quotes every user-facing command in Core flows with flags and verbs its script description documents',async()=>{
 const {renderSkill,skillTree}=await import('@/lib/skills');
 const {COMMANDS:registry}=await import('../../../skills/artifactbin/scripts/toolbox-commands.mjs');
 const {describe,descriptionOf}=await import('../../../skills/artifactbin/scripts/toolbox-description.mjs');
 const COMMANDS:Record<string,any>=registry;
 const skill=renderSkill(skillTree().get('artifactbin/SKILL.md')!,{base:'https://example.test'});
 const flows=skill.slice(skill.indexOf('## Core flows'),skill.indexOf('## Optional HTML components'));
 expect(flows.length).toBeGreaterThan(500);
 // Every command (the autofix helper included) appears in the flows, each as a real invocation;
 // a starter's own command (registry `starter`) is quoted by that starter's Usage instead.
 const calls=[...flows.matchAll(/node scripts\/([\w-]+)\.mjs([^`&]*)[`&]/g)];
 const {readFileSync}=await import('node:fs');
 for(const name of Object.keys(COMMANDS)){
  if(calls.some(call=>call[1]===name))continue;
  expect(COMMANDS[name].starter,name).toBeTruthy();
  const usage=/\/\/ Usage:[\s\S]*?\/\/ Built with:/.exec(readFileSync(new URL(`../../../skills/artifactbin/${COMMANDS[name].starter}`,import.meta.url),'utf8'))?.[0]??'';
  expect(usage,name).toContain(`node scripts/${name}.mjs --title`);
 }
 for(const [,name,rest] of calls){
  expect(COMMANDS[name!],name).toBeDefined();
  const description=descriptionOf(name!);
  // Flags used in the flows are documented by the script itself; so is a leading verb (list, reply, watch ...).
  for(const flag of rest!.match(/--[a-z-]+/g)??[])expect(description,`${name} ${flag}`).toContain(flag);
  const verb=rest!.trim().split(/\s+/)[0]!;
  if(COMMANDS[name!].sub&&Object.hasOwn(COMMANDS[name!].sub,verb))expect(description,`${name} ${verb}`).toContain(verb);
 }
 // The summary line of each command is the short description an agent sees at the top of its script.
 for(const name of Object.keys(COMMANDS))expect(describe(name).summary).toBe(descriptionOf(name).split('\n')[0]);
});

const scripts=new URL('../../../skills/artifactbin/scripts/',import.meta.url);
it('keeps one DESCRIPTION per command at the very top of its script, and --help prints exactly that',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {COMMANDS:registry}=await import('../../../skills/artifactbin/scripts/toolbox-commands.mjs');
 const {commandHelp,descriptionOf,describe}=await import('../../../skills/artifactbin/scripts/toolbox-description.mjs');
 const COMMANDS:Record<string,any>=registry;
 for(const name of Object.keys(COMMANDS)){
  const source=await readFile(new URL(`${name}.mjs`,scripts),'utf8');
  // A comment, then the export, before any import: an agent running head sees it.
  expect(source.indexOf('export const DESCRIPTION'),name).toBeLessThan(source.indexOf('import '));
  expect(source.split('\n')[0],name).toMatch(/^\/\*\*? .*\*\/$|^\/\//);
  expect(commandHelp(name)).toBe(descriptionOf(name)+'\n');
  expect(describe(name).summary.length,name).toBeGreaterThan(10);
  // Every flag the parser accepts is explained where the reader looks.
  const flags=[...Object.keys(COMMANDS[name].flags??{}),...(Object.values(COMMANDS[name].sub??{}) as object[]).flatMap(group=>Object.keys(group))];
  for(const flag of flags)expect(descriptionOf(name),`${name} --${flag}`).toContain('--'+flag);
 }
});
it('does not ask agents to write what the platform adds, and says what each side does',async()=>{
 const {readFile}=await import('node:fs/promises');
 const skill=await readFile(new URL('../../../skills/artifactbin/SKILL.md',import.meta.url),'utf8');
 const http=skill;
 expect(http).toContain('You write / the platform adds');
 // No setup boilerplate: the core tag, html design attributes and copied stylesheets are the platform's.
 expect(http).not.toMatch(/<script src="\/af\/[^"]*core\.js"/);
 expect(http).not.toMatch(/(?:write|add|load|keep)[^.\n]*core (?:script )?tag/i);
 expect(http).not.toMatch(/<html[^>]*data-af-[a-z-]+="/);
 for(const example of ['report','csv-dashboard','tracker','api-dashboard','deck']){
  const html=await readFile(new URL(`../../../skills/artifactbin/examples/${example}.html`,import.meta.url),'utf8');
  expect(html,example).not.toContain('core.js');expect(html,example).toContain('artifactbin:design-system');
 }
});
it('logout revokes the saved grant by default without refreshing or revoking environment overrides and retains failures',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {authCommand}=await import('../../../skills/artifactbin/scripts/auth.mjs');
 const {platform}=await import('../../../skills/artifactbin/scripts/toolbox-client.mjs');
 const shared=await platform(),root=await mkdtemp(path.join(tmpdir(),'auth-revoke-')),server='https://example.test';
 const saved={server,token:'synthetic-saved',refreshToken:'synthetic-refresh',clientId:'synthetic-client',expiresAt:1};
 try{
  await shared.saveCredentials(saved,root);
  let calls=0,offline=false,reply=()=>new Response('',{status:503});
  const options={env:{ARTIFACTBIN_HOME:root,ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'synthetic-environment'},fetcher:async(url:string|URL|Request,init:RequestInit={})=>{
   calls++;expect(String(url)).toBe(server+'/oauth/revoke');expect(JSON.parse(init.body as string)).toEqual({client_id:saved.clientId,token:saved.refreshToken});
   expect(JSON.stringify(init)).not.toContain('synthetic-environment');if(offline)throw new TypeError('fetch failed');return reply();
  }};
  const logout=(values:Record<string,boolean>={})=>authCommand({sub:'logout',values,positionals:[]},options);
  // Unconfirmed revocation fails nonzero, says the server grant may still be active, and keeps the saved grant for retry.
  const refused=(reason:string)=>({code:'revoke_unavailable',exit:1,details:{serverRevoked:false,localGrantRemoved:false,reason}});
  await expect(logout()).rejects.toMatchObject(refused('http_503'));
  expect(await shared.readCredentials(server,root)).toEqual(saved);
  offline=true;await expect(logout()).rejects.toMatchObject(refused('network'));offline=false;
  reply=()=>Response.json({error:'invalid_request'},{status:400});await expect(logout()).rejects.toMatchObject(refused('invalid_request'));
  expect(await shared.readCredentials(server,root)).toEqual(saved);expect(calls).toBe(3);
  reply=()=>Response.json({});const result=await logout();
  expect(result).toMatchObject({serverRevoked:true,localGrantRemoved:true,environmentGrantStillActive:true});
  expect(result).not.toHaveProperty('note');
  expect(JSON.stringify(result)).not.toContain('synthetic');expect(calls).toBe(4);expect(await shared.readCredentials(server,root)).toBeNull();
  // A grant the server already ended counts as revoked.
  for(const error of ['invalid_grant','revoked_token']){
   await shared.saveCredentials(saved,root);reply=()=>Response.json({error},{status:400});
   expect(await logout()).toMatchObject({serverRevoked:true,localGrantRemoved:true});expect(await shared.readCredentials(server,root)).toBeNull();
  }
  // --local is the explicit offline removal.
  await shared.saveCredentials(saved,root);
  expect(await logout({local:true})).toMatchObject({serverRevoked:false,localGrantRemoved:true,environmentGrantStillActive:true,note:expect.stringContaining('not revoke')});
  expect(await shared.readCredentials(server,root)).toBeNull();
  // Nothing saved: nothing to revoke, no request, and the result never claims a revocation.
  expect(await logout()).toMatchObject({serverRevoked:false,localGrantRemoved:true,environmentGrantStillActive:true,note:expect.stringContaining('No saved grant')});
  expect(calls).toBe(6);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('forwards the eligible anonymous public-view receipt to the publication result',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {finishPublication}=await import('../../../skills/artifactbin/scripts/toolbox-publish-finish.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'public-view-receipt-'));
 try{
  const result=await finishPublication({saved:{server:'https://app.example.test',body:{dataset:[{value:1}]},source:{file:path.join(root,'absent.json'),output:path.join(root,'data.json'),root}},receipt:{id:'PAGE12',url:'https://app.example.test/a/PAGE12',user_page_url:'https://alice.u.example.test/PAGE12-plan',version:1,state:'saved',format:'dataset'},journal:path.join(root,'publish')});
  expect(result.user_page_url).toBe('https://alice.u.example.test/PAGE12-plan');
 }finally{await rm(root,{recursive:true,force:true});}
});
it('publish --template applies a new dataset\'s starting permissions after the create, and only then',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {publishCommand}=await import('../../../skills/artifactbin/scripts/toolbox-publish.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'publish-template-')),server='https://example.test';
 try{
  const project=path.join(root,'project');await (await import('node:fs/promises')).mkdir(project);const csv=path.join(project,'signups.csv'),page=path.join(project,'index.html');
  await writeFile(csv,'name,created_by\nAda,\n');await writeFile(page,'<!doctype html><html><head><title>T</title></head><body><h1>Hi</h1></body></html>');
  const seen:Array<{method:string;path:string;body?:any}>=[];
  const fetcher=async(url:any,init:any)=>{
   const {pathname,search}=new URL(String(url)),method=init?.method??'GET',body=init?.body?JSON.parse(String(init.body)):undefined;seen.push({method,path:pathname+search,body});
   if(pathname==='/api/artifacts'&&method==='POST')return Response.json({id:'DATA12',url:server+'/a/DATA12',version:1,state:'a'.repeat(64),format:'dataset'},{status:201});
   if(pathname==='/api/artifacts/DATA12/policy/templates')return Response.json({revision:1,templates:[{name:'own-rows',ok:true,policy:{version:3,tables:[]}}]});
   if(pathname==='/api/artifacts/DATA12/policy'&&method==='PUT')return Response.json({saved:true,revision:2,readBack:'Table public.rows\n- Owner, editors: see and change everything.'});
   return Response.json({error:'unexpected'},{status:500});
  };
  const options={env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'private-fixture',ARTIFACTBIN_HOME:path.join(root,'home')},fetcher,log:()=>{}};
  await expect(publishCommand({values:{server,template:'own-rows'},positionals:[page]},options)).rejects.toMatchObject({code:'template_requires_dataset'});
  await expect(publishCommand({values:{server,template:'everyone'},positionals:[csv]},options)).rejects.toMatchObject({exit:2});
  expect(seen).toEqual([]);
  const done=await publishCommand({values:{server,template:'own-rows','owner-column':'created_by'},positionals:[csv]},options);
  expect(done.permissions).toEqual({template:'own-rows',revision:2,readBack:['Table public.rows','- Owner, editors: see and change everything.']});
  expect(seen.map(r=>r.method+' '+r.path)).toEqual(['POST /api/artifacts','GET /api/artifacts/DATA12/policy/templates?ownerColumn=created_by','PUT /api/artifacts/DATA12/policy']);
  expect(seen[2]!.body).toEqual({policy:{version:3,tables:[]},expectedPolicyRevision:1});
  // An existing dataset changes permissions through policy.mjs, never a republish.
  await expect(publishCommand({values:{server,template:'read-only',artifact:'DATA12'},positionals:[csv]},options)).rejects.toMatchObject({code:'template_not_for_update'});
  expect(seen).toHaveLength(3);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('publish --name sends a new dataset\'s GraphQL root in the create body, and only then',async()=>{
 const {mkdtemp,writeFile,rm,mkdir}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {publishCommand}=await import('../../../skills/artifactbin/scripts/toolbox-publish.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'publish-name-')),server='https://example.test';
 try{
  const project=path.join(root,'project');await mkdir(project);const csv=path.join(project,'orders.csv'),page=path.join(project,'index.html');
  await writeFile(csv,'item,amount\ntea,3\n');await writeFile(page,'<!doctype html><html><head><title>T</title></head><body><h1>Hi</h1></body></html>');
  const seen:Array<{method:string;path:string;body?:any}>=[];
  const fetcher=async(url:any,init:any)=>{
   const {pathname}=new URL(String(url)),method=init?.method??'GET',body=init?.body?JSON.parse(String(init.body)):undefined;seen.push({method,path:pathname,body});
   if(pathname==='/api/artifacts'&&method==='POST')return Response.json({id:'DATA12',url:server+'/a/DATA12',version:1,state:'a'.repeat(64),format:'dataset'},{status:201});
   return Response.json({error:'unexpected'},{status:500});
  };
  const options={env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'private-fixture',ARTIFACTBIN_HOME:path.join(root,'home')},fetcher,log:()=>{}};
  await expect(publishCommand({values:{server,name:'orders'},positionals:[page]},options)).rejects.toMatchObject({code:'name_requires_dataset',exit:2});
  expect(seen).toEqual([]);
  await publishCommand({values:{server,name:'orders'},positionals:[csv]},options);
  expect(seen.map(r=>r.method+' '+r.path)).toEqual(['POST /api/artifacts']);
  expect(seen[0]!.body).toMatchObject({name:'orders',visibility:'unlisted'});
  // The name is fixed at creation: an update never sends one.
  await expect(publishCommand({values:{server,name:'renamed',artifact:'DATA12'},positionals:[csv]},options)).rejects.toMatchObject({code:'name_not_for_update',exit:2});
  expect(seen).toHaveLength(1);
  // Without --name a new dataset is named after its file, the name a page links it by: agents
  // published "Onboarding stage times" (root onboarding_stage_times) and linked it as onboarding.
  const named=path.join(project,'Onboarding Stages.csv'),generic=path.join(project,'dataset.csv');
  await writeFile(named,'stage,days\nreview,2\n');await writeFile(generic,'a\n1\n');
  await publishCommand({values:{server,title:'Onboarding stage times'},positionals:[named]},options);
  expect(seen.at(-1)!.body).toMatchObject({name:'onboarding_stages',title:'Onboarding stage times'});
  await publishCommand({values:{server},positionals:[generic]},options);
  expect(seen.at(-1)!.body.name).toBeUndefined();
 }finally{await rm(root,{recursive:true,force:true});}
});
it('reads Built with from the page starter comment, and only datasets with a stored policy for who can do what',async()=>{
 const {builtWith,datasetLinks,replyFacts}=await import('../../../skills/artifactbin/scripts/toolbox-check-reply.mjs');
 const {readFile}=await import('node:fs/promises');
 const app=await readFile(new URL('../../../skills/artifactbin/examples/tracker.html',import.meta.url),'utf8');
 expect(builtWith(app)).toMatch(/^one HTML page; .* read and written with sql; tracker\.ts functions\.$/);expect(builtWith(app)).not.toContain('//');
 expect(builtWith('<!-- Example: x.\nBuilt with: one HTML page and\n  a CSV dataset. -->\n<p>x</p>')).toBe('one HTML page and a CSV dataset.');
 expect(builtWith('<p>no starter</p>')).toBeNull();
 const html='<link rel="af-dataset" data-af-name="targets" href="ref:DATA12"><link href="ref:DATA34" rel="af-dataset" data-af-name="rows"><link rel="stylesheet" href="ref:CSS123">';
 expect(datasetLinks(html)).toEqual([{id:'DATA12',name:'targets'},{id:'DATA34',name:'rows'}]);
 const client={request:async(route:string)=>route.endsWith('DATA12/policy')?{source:'v3',readBack:'Table public.targets\n- Owner, editors: see and change everything.\n'}:{source:'none',readBack:'Table public.rows\n- Owner, editors: see and change everything.'}};
 expect(await replyFacts(client,'https://h.test','PAGE12',html)).toEqual({id:'PAGE12',link:'https://h.test/a/PAGE12',permissions:[{id:'DATA12',name:'targets',lines:['Table public.targets','- Owner, editors: see and change everything.']}]});
});
it('checks a deck at deck viewports without --viewport and attaches the reply facts to a passing run',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {checkCommand}=await import('../../../skills/artifactbin/scripts/check.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'check-deck-'));
 const html='<link rel="af-dataset" data-af-name="sales" href="ref:DATA12"><script>// Built with: one HTML page from a SLIDES data block\n</script><section data-af-slide>One</section>';
 const sizes:string[]=[];
 const fetcher=async(input:any,init:any)=>{const url=new URL(String(input));
  if(url.pathname==='/a/PAGE12/raw')return new Response(html);
  if(url.pathname==='/api/artifacts/DATA12/policy')return Response.json({source:'v3',readBack:'Table public.sales\n- Signed-out link holders: see rows.'});
  if(url.pathname==='/api/artifacts/DATA12')return Response.json({id:'DATA12'});
  const body=JSON.parse(String(init.body));if(body.op==='close')return Response.json({session_id:body.session_id,status:'closed'});
  const size=/"width":(\d+),"height":(\d+)/.exec(body.code)!;sizes.push(size[1]+'x'+size[2]);
  // Only the first viewport of the signed-in run asks for the slides; the session answers with each as a PNG.
  const slides=/"slides":true/.test(body.code);if(slides)sliced.push(size[1]+'x'+size[2]);
  const screenshot={mime:'image/png',scope:'reader-viewport',base64:Buffer.from('view').toString('base64'),
   ...(slides?{slides:[1,2].map(n=>({base64:Buffer.from('slide '+n).toString('base64'),width:1200,height:630}))}:{})};
  return Response.json({session_id:body.session_id,execution_id:body.execution_id,status:'completed',result:{viewport:{width:Number(size[1]),height:Number(size[2])},pageErrors:[],consoleErrors:[],failedRequests:[],httpErrors:[],telemetry:[],text:'Ready',overflow:{viewport:1,content:1,fits:true},slides:{count:2},screenshot}});};
 const sliced:string[]=[];
 try{
  const result=await checkCommand({values:{},positionals:['PAGE12']},{env:{ARTIFACTBIN_URL:'https://h.test',ARTIFACTBIN_TOKEN:'t',ARTIFACTBIN_HOME:root},fetcher});
  expect(sizes.sort()).toEqual(['1200x630','1280x800']);expect(sliced).toEqual(['1200x630']);
  // Each slide is saved beside the viewport screenshots; the result names the files, never their bytes.
  const shot=(result.checks.find((check:any)=>check.viewport.width===1200) as any).screenshot;
  expect(shot.slides).toEqual([1,2].map(n=>({path:path.join(path.dirname(shot.path),`1200x630-slide-${n}.png`),width:1200,height:630})));
  const {readFile}=await import('node:fs/promises');
  expect(await Promise.all(shot.slides.map((s:any)=>readFile(s.path,'utf8')))).toEqual(['slide 1','slide 2']);
  expect(JSON.stringify(result)).not.toContain(Buffer.from('slide 1').toString('base64'));
  expect(result.slideLinks).toEqual(['https://h.test/a/PAGE12/export?format=png&slide=1','https://h.test/a/PAGE12/export?format=png&slide=2']);
  expect(result.reply).toEqual({id:'PAGE12',link:'https://h.test/a/PAGE12',builtWith:'one HTML page from a SLIDES data block',permissions:[{id:'DATA12',name:'sales',lines:['Table public.sales','- Signed-out link holders: see rows.']}]});
  // An explicit --viewport wins.
  sizes.length=0;await checkCommand({values:{viewport:['390x844']},positionals:['PAGE12']},{env:{ARTIFACTBIN_URL:'https://h.test',ARTIFACTBIN_TOKEN:'t',ARTIFACTBIN_HOME:root},fetcher});
  expect(sizes).toEqual(['390x844']);expect(sliced).toEqual(['1200x630','390x844']);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('fails a published page that links a dataset but never reads it, and passes one read in any viewport',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {checkCommand}=await import('../../../skills/artifactbin/scripts/check.mjs');
 const {checkDigest,toolFailure}=await import('../../../skills/artifactbin/scripts/toolbox-client.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'check-unread-'));
 const html='<link rel="af-dataset" data-af-name="sales" href="ref:DATA12"><main>Total $1,240</main>';
 let reads:Record<string,number>={};
 const fetcher=async(input:any,init:any)=>{const url=new URL(String(input));
  if(url.pathname==='/a/PAGE12/raw')return new Response(html);
  if(url.pathname==='/api/artifacts/DATA12/policy')return Response.json({source:'v3',readBack:'Table public.sales'});
  if(url.pathname==='/api/artifacts/DATA12')return Response.json({id:'DATA12'});
  const body=JSON.parse(String(init.body));if(body.op==='close')return Response.json({session_id:body.session_id,status:'closed'});
  const [,w,h]=/"width":(\d+),"height":(\d+)/.exec(body.code)!;
  return Response.json({session_id:body.session_id,execution_id:body.execution_id,status:'completed',result:{viewport:{width:Number(w),height:Number(h)},pageErrors:[],consoleErrors:[],failedRequests:[],httpErrors:[],telemetry:[],text:'Total $1,240',overflow:{viewport:1,content:1,fits:true},steps:{ran:true,passed:true},verified:['total shows'],datasetReads:reads[w!]??0}});};
 const env={ARTIFACTBIN_URL:'https://h.test',ARTIFACTBIN_TOKEN:'t',ARTIFACTBIN_HOME:root};
 try{
  const error=await checkCommand({values:{},positionals:['PAGE12']},{env,fetcher}).catch((e:any)=>e);
  expect(error).toMatchObject({code:'check_failed',details:{smokePassed:false,unreadDatasets:[{id:'DATA12',name:'sales'}]}});
  expect(error.details.reply).toBeUndefined();
  const digest=checkDigest(toolFailure('check',error));
  expect(digest).toContain('page links dataset sales but never reads it on load or in your steps: compute its numbers from its rows in page script (references/datasets.md#read)');
  expect(digest).not.toContain('For your reply:');expect(digest).not.toContain('clean pass');
  // One viewport reading it (say a step clicked a lazy tab there) is enough.
  reads={'390':2};
  const passed=await checkCommand({values:{},positionals:['PAGE12']},{env,fetcher});
  expect(passed.smokePassed).toBe(true);expect(passed.unreadDatasets).toBeUndefined();expect(passed.reply?.permissions).toHaveLength(1);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('lists what an unset secret blocked as Not tested and names every other failed call with its owner detail',async()=>{
 const {mkdtemp,rm,writeFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {checkCommand}=await import('../../../skills/artifactbin/scripts/check.mjs');
 const {checkDigest,toolFailure}=await import('../../../skills/artifactbin/scripts/toolbox-client.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'check-secret-')),steps=path.join(root,'steps.mjs'),guest=path.join(root,'guest.mjs');
 await writeFile(steps,"await step('Forecast shows',async()=>{});");await writeFile(guest,"await step('Guest sees alerts',async()=>{});");
 const failed='Backend execution failed',base={pageErrors:[],consoleErrors:[],failedRequests:[],httpErrors:[],telemetry:[],text:'Pipeline',overflow:{viewport:1,content:1,fits:true},steps:{ran:true,passed:false},verified:['board loads']};
 const unset={field:'fn/forecast',kind:'fn',message:failed,code:'backend_failed',detail:'secret_unavailable: WEATHER_KEY',pageErrorsBefore:0,consoleErrorsBefore:0};
 const notOnPage={field:'sql',kind:'sql',message:'no such table',code:'invalid_sql',detail:'no such table: deal_notes',pageErrorsBefore:0,consoleErrorsBefore:1};
 // What the page logged after the refusal came from it.
 const blocked={...base,consoleErrors:[failed+' {"code":"backend_failed"}'],error:'Timeout 6000ms exceeded (step call #2 page.getByText("Sunny"))',failedStep:'Forecast shows',callErrors:[unset]};
 const quiet={...base,steps:{ran:true,passed:true}};
 let results:Record<string,any>={},set:string[]=[];const asked:string[]=[],replays:any[]=[];
 const fetcher=async(input:any,init:any)=>{const url=new URL(String(input));asked.push(url.pathname);
  if(url.pathname==='/a/PAGE12/raw')return new Response('<main>Pipeline</main>');
  if(url.pathname==='/api/my/artifacts/PAGE12/resolvers')return Response.json({revision:'3',resolvers:[{name:'weather',backendId:'BACK12',version:'v1',test:false,secrets:{WEATHER_KEY:'api.weather.test'},set}]});
  if(url.pathname==='/api/artifacts/PAGE12/fn/forecast'){replays.push({fn:url.pathname+url.search,method:init?.method??'GET'});return Response.json({error:'backend_failed',message:'The function failed',detail:'HTTP 401: Upstream refused'},{status:500});}
  if(url.pathname==='/api/artifacts/PAGE12/sql'){replays.push(JSON.parse(String(init.body)));return Response.json({columns:[],rows:[]});}
  const body=JSON.parse(String(init.body));if(body.op==='close')return Response.json({session_id:body.session_id,status:'closed'});
  const [,w,h]=/"width":(\d+),"height":(\d+)/.exec(body.code)!,found=results[(body.viewer??'self')+w]??quiet;
  return Response.json({session_id:body.session_id,execution_id:body.execution_id,status:'completed',result:{...found,viewport:{width:Number(w),height:Number(h)}}});};
 const env={ARTIFACTBIN_URL:'https://h.test',ARTIFACTBIN_TOKEN:'t',ARTIFACTBIN_HOME:root};
 const check=(values:Record<string,unknown>)=>checkCommand({values:{steps,...values},positionals:['PAGE12']},{env,fetcher});
 const why="(needs secret WEATHER_KEY, which the owner sets in the page's Resolvers settings)";
 try{
  // Unset: the blocked step is Not tested, the errors it caused are gone, and the pass ends on the reply facts.
  results={self1280:blocked,self390:blocked};
  const passed=await check({});
  expect(passed.smokePassed).toBe(true);expect(passed.needsSecrets).toEqual([{step:'Forecast shows',fields:['fn/forecast'],secrets:['WEATHER_KEY']}]);
  expect(passed.checks[0]).toMatchObject({consoleErrors:[],needsSecret:{step:'Forecast shows',secrets:['WEATHER_KEY']}});
  expect(passed.checks[0].error).toBeUndefined();expect(passed.callFailures).toBeUndefined();
  const proved=checkDigest({ok:true,code:'completed',...passed});
  expect(proved).not.toContain(`  Not tested: "Forecast shows"`);
  expect(proved).toContain(`\nNot tested: "Forecast shows" ${why}; visual appearance\n`);
  expect(proved).toMatch(/1280x800: no errors.*steps stopped at "Forecast shows": needs secret WEATHER_KEY/);
  // The same refusal for a secret the owner did set is a failure that names the field and the detail.
  set=['WEATHER_KEY'];
  const stillSet=await check({}).catch((e:any)=>e);
  expect(stillSet).toMatchObject({code:'check_failed',details:{smokePassed:false}});
  const named=checkDigest(toolFailure('check',stillSet));
  expect(named).toContain('  function forecast failed: secret_unavailable: WEATHER_KEY (owner detail)');
  expect(named).not.toContain('Not tested');expect(named).not.toContain('For your reply:');
  // Another failed call in the same viewport keeps it failing, and so does an error logged before
  // the refusal; the step is still Not tested there.
  set=[];results={self1280:{...blocked,consoleErrors:['favicon missing',failed],callErrors:[{...unset,consoleErrorsBefore:1}]},
   self390:{...blocked,consoleErrors:['favicon missing',failed],callErrors:[unset,notOnPage]}};
  const mixed=await check({}).catch((e:any)=>e);
  expect(mixed.details.smokePassed).toBe(false);
  const both=checkDigest(toolFailure('check',mixed));
  expect(both).toContain('  sql failed: no such table: deal_notes (owner detail)');
  expect(both).toContain(`  Not tested: "Forecast shows" ${why}`);expect(both).not.toContain('For your reply:');
  expect(both).toMatch(/1280x800: consoleErrors 1: favicon missing; .*steps stopped at "Forecast shows"/);
  expect(both).toMatch(/390x844: consoleErrors 2: favicon missing; .*task error: Timeout/);
  // A call that failed for the owner fails the check even when every step passed.
  results={self1280:{...quiet,callErrors:[notOnPage]},self390:quiet};
  const unnoticed=await check({}).catch((e:any)=>e);
  expect(unnoticed).toMatchObject({code:'check_failed',details:{smokePassed:false}});
  expect(checkDigest(toolFailure('check',unnoticed))).not.toContain('For your reply:');
  // A guest gets no detail: a read is asked again as the owner, a write never is.
  const fnFailed={message:'The function failed',code:'backend_failed',pageErrorsBefore:0,consoleErrorsBefore:0};
  results={guest1280:{...base,consoleErrors:[failed],error:'Timeout',failedStep:'Guest sees alerts',callErrors:[
   {field:'fn/forecast',kind:'fn',...fnFailed,replay:{search:'?city=Oslo'}},{field:'fn/addNote',kind:'fn',...fnFailed},
   {field:'sql',kind:'sql',message:'not allowed',code:'permission_denied',pageErrorsBefore:0,consoleErrorsBefore:0,replay:{sql:'select count(*) as n from notes',params:{},revision:'3'}}]}};
  const asGuest=await check({'guest-steps':guest}).catch((e:any)=>e);
  // Reads are asked again as the owner (a GET function, a SELECT); writes never are.
  expect(replays).toEqual([{fn:'/api/artifacts/PAGE12/fn/forecast?city=Oslo',method:'GET'},{sql:'select count(*) as n from notes',params:{},revision:'3'}]);
  const told=checkDigest(toolFailure('check',asGuest));
  expect(told).toContain('  function forecast failed for the guest (backend_failed); as owner the detail is: HTTP 401: Upstream refused');
  expect(told).toContain('  function addNote failed for the guest (backend_failed); not a read, so it was not run again as owner');
  expect(told).toContain('  sql failed for the guest (permission_denied); as owner it succeeds');
  expect(told).not.toContain('select count');expect(told).not.toContain('Bearer');
  // An unset secret a function needed is Not tested under the function's name.
  results={self1280:{...blocked,callErrors:[{...unset,field:'fn/forecast',kind:'fn'}]},self390:quiet};
  const fnUnset=await check({});
  expect(fnUnset.needsSecrets).toEqual([{step:'Forecast shows',fields:['fn/forecast'],secrets:['WEATHER_KEY']}]);
  expect(checkDigest({ok:true,code:'completed',...fnUnset,checks:fnUnset.checks.map((c:any)=>({...c,error:undefined}))})).toContain('WEATHER_KEY');
  // No failed call with a secret's detail: no resolver read at all.
  expect(asked.filter(p=>p.endsWith('/resolvers'))).toHaveLength(4);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('repeats a status read through a transient network failure but never resubmits a lost script',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {checkCommand}=await import('../../../skills/artifactbin/scripts/check.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'check-status-retry-'));const ops:string[]=[];let blips=1;
 const fetcher=async(input:any,init:any)=>{const url=new URL(String(input));if(url.pathname!=='/api/browser-sessions')return new Response('<p>page</p>');
  const body=JSON.parse(String(init.body));ops.push(body.op);
  if(body.op==='script')throw Error('connection reset');
  if(body.op==='status'&&blips-->0)throw Error('connection reset');
  if(body.op==='close')return Response.json({session_id:body.session_id,status:'closed'});
  return Response.json({session_id:body.session_id,execution_id:body.execution_id,status:'completed',result:{viewport:{width:390,height:844},pageErrors:[],consoleErrors:[],failedRequests:[],httpErrors:[],telemetry:[],text:'Ready',overflow:{viewport:390,content:390,fits:true}}});};
 try{
  const result=await checkCommand({values:{viewport:['390x844']},positionals:['PAGE12']},{env:{ARTIFACTBIN_URL:'https://h.test',ARTIFACTBIN_TOKEN:'t',ARTIFACTBIN_HOME:root},fetcher,retryDelays:[0,0]});
  expect(result.smokePassed).toBe(true);expect(ops).toEqual(['script','status','status','close']);
 }finally{await rm(root,{recursive:true,force:true});}
});
/** A fake server for publish/read: GET a page head (with its recorded receipts), POST/PUT a page that then becomes
 * the head; every request is recorded. */
function fakePages(head:{id:string,version:number,state:string,html:string,format?:string,sharing_revision?:number,dependencyReceipts?:unknown[]}){
 const sent:any[]=[];let page:any={format:'html',sharing_revision:0,dependencyReceipts:[],...head};
 const fetcher=async(input:any,init:any)=>{const url=new URL(String(input)),method=init?.method??'GET',body=init?.body?JSON.parse(String(init.body)):undefined;sent.push({method,path:url.pathname,body});
  if(method==='GET')return Response.json(page);
  page=method==='PUT'?{...page,version:page.version+1}:{...page,id:'NEW123',version:1};
  page={...page,state:(page.version%2?'c':'d').repeat(64),html:body.html};
  return Response.json({id:page.id,url:'https://h.test/a/X',version:page.version,state:page.state,html:body.html,format:'html'},{status:method==='PUT'?200:201});};
 return {sent,fetcher};
}
const WATCH_NEXT='Next: when the request is done, reply to the user and run the comment watch, even when the reply is only the link. Nothing may hold back your reply: it is every link the user asked for, in the form they asked for (a page\'s public view is its receipt\'s user_page_url), plus what they asked. The watch waits only once that reply is sent: its first call after you publish, edit or comment returns at once, and so does every call until one adds --replied, which you add only after sending the reply. Claude Code: start the watch, one per page, with the Bash tool\'s run_in_background first, then send your reply as your last message and end your turn; when that first call wakes you, start it again with --replied the same way. Other harnesses: say your reply to the user, then call the watch in the foreground with its default wait and a shell timeout of at least 300000 ms, then once more with --replied; several pages share each call (node scripts/comment.mjs watch A --next --replied & node scripts/comment.mjs watch B --next --replied & wait). Once waiting, it returns as soon as someone comments, and on its own within 4 minutes: handle what it printed and run it again until it says to stop watching. Watching follows every task, however short the reply.';
/** No flow ever leaves a file beside the source. */
async function noCompanions(...dirs:string[]){const {readdir}=await import('node:fs/promises');
 for(const dir of dirs)expect((await readdir(dir)).filter(name=>name.endsWith('.af.json')),dir).toEqual([]);}
it('publish refuses an empty page and starter placeholders by line, and drops hand-written ids on a new page',async()=>{
 const {mkdtemp,rm,writeFile,readFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {publishCommand}=await import('../../../skills/artifactbin/scripts/toolbox-publish.mjs');
 const {sourceIdentity}=await import('../../../skills/artifactbin/scripts/toolbox-source.mjs');
 const home=await mkdtemp(path.join(tmpdir(),'publish-guard-')),dir=path.join(home,'project');await (await import('node:fs/promises')).mkdir(dir);const {sent,fetcher}=fakePages({id:'PAGE12',version:3,state:'a'.repeat(64),html:''});
 const options={env:{ARTIFACTBIN_URL:'https://h.test',ARTIFACTBIN_TOKEN:'t',ARTIFACTBIN_HOME:path.join(home,'home')},fetcher,log:()=>{}};
 try{
  const file=path.join(dir,'index.html');
  for(const empty of ['','\n  \n','<!doctype html><html><head><title>x</title></head><body>\n</body></html>']){
   await writeFile(file,empty);
   await expect(publishCommand({values:{create:true},positionals:[file]},options)).rejects.toMatchObject({code:'empty_page',exit:2,recovery:expect.stringContaining('Write the page into index.html')});
  }
  await writeFile(file,'<!doctype html>\n<title>[Tracker name]</title>\n<link rel="af-dataset" data-af-name="t" href="ref:DATASET_ID">\n<p>Hi</p>');
  const refused=await publishCommand({values:{create:true},positionals:[file]},options).catch((error:any)=>error);
  expect(refused).toMatchObject({code:'autofix_refused'});
  expect(refused.details.autofix.problems.map((p:any)=>[p.rule,p.line])).toEqual([['starter-placeholder',2],['starter-placeholder',3]]);
  expect(refused.details.autofix.report).toContain('ref:DATASET_ID is a starter placeholder: link the data file by its path (href="./FILE.csv") or put a real ID after ref:');
  expect(refused.details.autofix.report).toContain('starter placeholder [Tracker name] is still in the page');
  expect(sent).toEqual([]);
  // A starter's own code and comments are not placeholders: an index expression, a ref: in a comment.
  const {placeholderProblems}=await import('../../../skills/artifactbin/scripts/toolbox-publish-guard.mjs');
  const deck=await readFile(new URL('../../../skills/artifactbin/examples/deck.html',import.meta.url),'utf8');
  expect(placeholderProblems(deck).map((p:any)=>p.snippet)).not.toContain('[DATASET]');
  expect(placeholderProblems(deck).filter((p:any)=>p.snippet.startsWith('href'))).toEqual([]);
  expect(placeholderProblems('<script>\n// add <link href="ref:ID">\n</script><!-- <link href="ref:ID"> --><p>x</p>',new Set())).toEqual([]);
  // A CSV with a header and no rows is an empty table: its columns are declared, so the server accepts it.
  const {emptyTable}=await import('../../../skills/artifactbin/scripts/toolbox-publish-guard.mjs');
  expect(emptyTable('.csv','deal_id,"note, text",created_by\n')).toEqual({columns:[{name:'deal_id',type:'string'},{name:'note, text',type:'string'},{name:'created_by',type:'string'}]});
  expect(emptyTable('.csv','a,b\n1,2\n')).toEqual({});
  expect(emptyTable('.json','[]')).toEqual({});
  // Only the starter a page was copied from (its kept header line) is matched in full: an unedited deck is refused on
  // its one-word placeholders, while a real page's own "[Draft]" or "[Company]" passes.
  expect(placeholderProblems(deck).map((p:any)=>p.snippet)).toEqual(expect.arrayContaining(['[Company]','[Product]']));
  expect(placeholderProblems('<!doctype html><title>[Draft] Q3 plan</title><p>[Company] and [Product] notes</p>')).toEqual([]);
  // A file without a marker is never taken for a new page by itself: it may be a published page rewritten whole.
  await writeFile(file,'<!doctype html>\n<h1 data-af-id="hero">Hi</h1><p data-af-id="hero">Lede</p>');
  const unmarked=await publishCommand({values:{},positionals:[file]},options).catch((error:any)=>error);
  expect(unmarked).toMatchObject({code:'unmarked_source',exit:2,message:'index.html has no af-authoring marker, so publish cannot tell which page it is.'});
  expect(unmarked.recovery).toBe('If it is a page you published before (rewritten whole, so its marker is gone): node scripts/publish.mjs index.html --artifact ID. Only for a new page: node scripts/publish.mjs index.html --create.');
  expect(sent).toEqual([]);
  // A new page with hand-written and repeated data-af-ids publishes; none of them is sent.
  const done=await publishCommand({values:{create:true},positionals:[file]},options);
  expect(sent.at(-1).method).toBe('POST');expect(sent.at(-1).body.html).not.toContain('data-af-id="hero"');
  expect(done.autofix.routine).toContain('dropped 2 hand-written data-af-id (the platform assigns them)');
  expect(done.next).toBe(WATCH_NEXT+'\n  node scripts/comment.mjs watch NEW123 --next');
  expect(sourceIdentity(await readFile(file,'utf8'))).toMatchObject({server:'https://h.test',id:'NEW123',version:1,entryPath:'index.html'});
  await noCompanions(dir);
 }finally{await rm(home,{recursive:true,force:true});}
});
it('publish FILE --artifact ID replaces that page over its current head when the file has no marker',async()=>{
 const {mkdtemp,rm,writeFile,readFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {publishCommand}=await import('../../../skills/artifactbin/scripts/toolbox-publish.mjs');
 const {sourceIdentity}=await import('../../../skills/artifactbin/scripts/toolbox-source.mjs');
 const receipts=[{path:'sales.csv',kind:'dataset',id:'DATA12',revision:'2',sha256:'e'.repeat(64)}];
 const home=await mkdtemp(path.join(tmpdir(),'publish-artifact-')),dir=path.join(home,'project');await (await import('node:fs/promises')).mkdir(dir);const {sent,fetcher}=fakePages({id:'PAGE12',version:3,state:'a'.repeat(64),html:'<h1 data-af-id="af-1">Old</h1>',sharing_revision:4,dependencyReceipts:receipts});
 const options={env:{ARTIFACTBIN_URL:'https://h.test',ARTIFACTBIN_TOKEN:'t',ARTIFACTBIN_HOME:path.join(home,'home')},fetcher,log:()=>{}};
 try{
  const file=path.join(dir,'index.html');await writeFile(file,'<!doctype html>\n<h1 data-af-id="af-1">New</h1>');
  const done=await publishCommand({values:{artifact:'PAGE12',visibility:'public'},positionals:[file]},options);
  expect(sent.map(r=>r.method+' '+r.path)).toEqual(['GET /api/artifacts/PAGE12','PUT /api/artifacts/PAGE12']);
  // The head is the baseline, with the page's recorded receipts: a rebuild reuses its datasets, never duplicates them.
  expect(sent[1].body).toMatchObject({expectedVersion:3,expectedState:'a'.repeat(64),expectedSharingRevision:4,visibility:'public'});
  const {path:_path,...mapping}=receipts[0]!;expect(sent[1].body.publicationBundle.mappings).toEqual({'sales.csv':mapping});
  expect(sent[1].body.html).toContain('data-af-id="af-1"');
  expect(done).toMatchObject({id:'PAGE12',version:4,updatedInPlace:true,note:'index.html replaced page PAGE12 (its version 3 was the baseline).'});
  expect(sourceIdentity(await readFile(file,'utf8'))).toMatchObject({id:'PAGE12',version:4});
  // Overwritten later (a starter copied over it): the marker is gone, so publish refuses and names both ways on.
  await writeFile(file,'<!doctype html>\n<h1>Starter</h1>');
  const refused=await publishCommand({values:{},positionals:[file]},options).catch((error:any)=>error);
  expect(refused).toMatchObject({code:'unmarked_source',recovery:expect.stringContaining('node scripts/publish.mjs index.html --artifact ID')});
  // With --artifact the same file recovers by itself.
  sent.length=0;
  expect(await publishCommand({values:{artifact:'PAGE12'},positionals:[file]},options)).toMatchObject({id:'PAGE12',version:5});
  expect(sent.map(r=>r.method)).toEqual(['GET','PUT']);expect(sent[1].body).not.toHaveProperty('expectedSharingRevision');
  // An update that names no visibility sends none: a public or private page stays as it is (it was sent 'unlisted',
  // which turned a public page unlisted and a private one into anyone-with-the-link on its next publish).
  expect(sent[1].body).not.toHaveProperty('visibility');
  // A marker that names the page is the baseline itself: its version is the one expected.
  sent.length=0;await writeFile(file,(await readFile(file,'utf8')).replace('Starter','Edited'));
  await publishCommand({values:{artifact:'PAGE12'},positionals:[file]},options);
  expect(sent.map(r=>r.method)).toEqual(['GET','PUT']);expect(sent[1].body).toMatchObject({expectedVersion:5});
  await expect(publishCommand({values:{artifact:'PAGE12',group:'team'},positionals:[path.join(dir,'index.html')]},{...options,fetcher:async()=>Response.json({format:'html',id:'OTHER1',version:1,state:'a'.repeat(64)})})).rejects.toMatchObject({code:'group_not_for_update'});
  await noCompanions(dir);
 }finally{await rm(home,{recursive:true,force:true});}
});
it('never overwrites a newer version, and refuses an exported page, a saved version, a cut marker and --create over a published file',async()=>{
 const {mkdtemp,rm,writeFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {publishCommand}=await import('../../../skills/artifactbin/scripts/toolbox-publish.mjs');
 const {stampSource}=await import('../../../skills/artifactbin/scripts/toolbox-source.mjs');
 const home=await mkdtemp(path.join(tmpdir(),'publish-refusals-')),dir=path.join(home,'project');await (await import('node:fs/promises')).mkdir(dir);
 const {sent,fetcher}=fakePages({id:'PAGE12',version:5,state:'f'.repeat(64),html:'<h1>Newer</h1>'});
 const options={env:{ARTIFACTBIN_URL:'https://h.test',ARTIFACTBIN_TOKEN:'t',ARTIFACTBIN_HOME:path.join(home,'home')},fetcher,log:()=>{}};
 const marker={server:'https://h.test',id:'PAGE12',version:3,state:'a'.repeat(64),sha256:'b'.repeat(64),entryPath:'index.html'};
 const publish=(values:Record<string,unknown>={})=>publishCommand({values,positionals:[file]},options).catch((error:any)=>error);
 const file=path.join(dir,'index.html');
 try{
  // Read at version 3, the page is at 5: refused before anything is written, with the one re-read step.
  await writeFile(file,stampSource('<!doctype html>\n<h1>Mine</h1>',marker));
  expect(await publish()).toMatchObject({code:'version_conflict',exit:4,message:'Page PAGE12 changed since index.html was saved (version 3 there, 5 now).',
   recovery:'Run node scripts/read.mjs PAGE12 --output index.html (an edited file is kept and the read goes beside it), reapply your edits there and publish that file.'});
  expect(sent.map(r=>r.method)).toEqual(['GET']);
  // A page read from a saved version would replace the newer page.
  sent.length=0;await writeFile(file,stampSource('<!doctype html>\n<h1>Old</h1>',{...marker,version:5,historical:true}));
  expect(await publish()).toMatchObject({code:'historical_source',exit:2,recovery:'To make it the current page anyway: node scripts/publish.mjs index.html --artifact PAGE12.'});
  // A marker cut or written by hand (here: the old {server,id,pair} shape) is unreadable: replace by id.
  await writeFile(file,'<!doctype html>\n<h1>Cut</h1>\n<!-- af-authoring:'+Buffer.from(JSON.stringify({server:'https://h.test',id:'PAGE12',pair:'p'})).toString('base64url')+' -->\n');
  expect(await publish()).toMatchObject({code:'invalid_marker',exit:2,recovery:expect.stringContaining('node scripts/publish.mjs index.html --artifact PAGE12')});
  await writeFile(file,stampSource('<!doctype html>\n<h1>Elsewhere</h1>',{...marker,server:'https://other.test'}));
  expect(await publish()).toMatchObject({code:'marker_origin_mismatch',exit:2});
  // --create over a file that is already a page would make a second page from one edit.
  await writeFile(file,stampSource('<!doctype html>\n<h1>Mine</h1>',{...marker,version:5}));
  expect(await publish({create:true})).toMatchObject({code:'already_published',exit:2,recovery:'To update page PAGE12: node scripts/publish.mjs index.html. For a second page from it, delete its last line (the af-authoring marker) first.'});
  // An exported page is not authoring source.
  await writeFile(file,'<!doctype html><html data-af="portable"><body><h1>Exported</h1></body></html>');
  expect(await publish()).toMatchObject({code:'exported_source',exit:2});
  expect(sent).toEqual([]);
  await noCompanions(dir);
 }finally{await rm(home,{recursive:true,force:true});}
});
it('publishing an exported page sends its page, never the rows or runtime it carries, and says so',async()=>{
 const {mkdtemp,mkdir,rm,writeFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {publishCommand}=await import('../../../skills/artifactbin/scripts/toolbox-publish.mjs');
 const {portableScript}=await import('../../html-runtime/portable');
 const home=await mkdtemp(path.join(tmpdir(),'publish-export-')),dir=path.join(home,'project');await mkdir(dir);
 const {sent,fetcher}=fakePages({id:'PAGE12',version:3,state:'a'.repeat(64),html:'<h1>Old</h1>'});
 const options={env:{ARTIFACTBIN_URL:'https://h.test',ARTIFACTBIN_TOKEN:'t',ARTIFACTBIN_HOME:path.join(home,'home')},fetcher,log:()=>{}};
 const source='<!doctype html><html><head><title>Report</title><script src="/af/core.js"></script></head><body><h1>Report</h1></body></html>';
 const exported=source.replace('<head>','<head>'+portableScript({version:1,source})+'<script type="application/json" data-af="offline-data">{"tables":[{"schema":"main","name":"staff","columns":[],"rows":[{"salary":"zebra-7731"}]}]}</script><script type="application/json" data-af="offline-sql">"engine"</script>');
 try{
  const file=path.join(dir,'report.html');
  for(const values of [{artifact:'PAGE12'},{create:true}]){
   await writeFile(file,exported);sent.length=0;
   const done=await publishCommand({values,positionals:[file]},options);
   const html=sent.at(-1).body.html;
   expect(html).toContain('<h1>Report</h1>');
   expect(html).not.toMatch(/zebra-7731|data-af="(?:offline-data|offline-sql|portable)"/);
   expect(done.note).toContain('report.html is an exported copy: published without the rows and runtime it carries.');
  }
 }finally{await rm(home,{recursive:true,force:true});}
});
it('a file copied into another folder still updates its own page',async()=>{
 const {mkdtemp,mkdir,rm,writeFile,readFile,copyFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {publishCommand}=await import('../../../skills/artifactbin/scripts/toolbox-publish.mjs');
 const home=await mkdtemp(path.join(tmpdir(),'publish-copy-')),a=path.join(home,'a'),b=path.join(home,'b');await mkdir(a);await mkdir(b);
 const {sent,fetcher}=fakePages({id:'PAGE12',version:1,state:'a'.repeat(64),html:''});
 const options={env:{ARTIFACTBIN_URL:'https://h.test',ARTIFACTBIN_TOKEN:'t',ARTIFACTBIN_HOME:path.join(home,'home')},fetcher,log:()=>{}};
 try{
  await writeFile(path.join(a,'index.html'),'<!doctype html>\n<h1>First</h1>');
  expect(await publishCommand({values:{create:true},positionals:[path.join(a,'index.html')]},options)).toMatchObject({id:'NEW123',version:1});
  await copyFile(path.join(a,'index.html'),path.join(b,'page.html'));
  await writeFile(path.join(b,'page.html'),(await readFile(path.join(b,'page.html'),'utf8')).replace('First','Moved'));
  sent.length=0;
  expect(await publishCommand({values:{},positionals:[path.join(b,'page.html')]},options)).toMatchObject({id:'NEW123',version:2,updatedInPlace:true});
  expect(sent.map(r=>r.method+' '+r.path)).toEqual(['GET /api/artifacts/NEW123','PUT /api/artifacts/NEW123']);
  expect(sent[1].body).toMatchObject({expectedVersion:1});expect(sent[1].body.html).toContain('Moved');
  await noCompanions(a,b);
 }finally{await rm(home,{recursive:true,force:true});}
});
it('read --output refreshes an unchanged file in place and saves beside a file with edits of its own',async()=>{
 const {mkdtemp,rm,writeFile,readFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {readCommand}=await import('../../../skills/artifactbin/scripts/read.mjs');
 const {sourceIdentity}=await import('../../../skills/artifactbin/scripts/toolbox-source.mjs');
 const dir=await mkdtemp(path.join(tmpdir(),'read-refresh-'));let version=3;
 const options={env:{ARTIFACTBIN_URL:'https://h.test',ARTIFACTBIN_TOKEN:'t'},fetcher:async()=>Response.json({id:'PAGE12',format:'html',version,state:'a'.repeat(64),html:`<h1 data-af-id="h">v${version}</h1>`})};
 try{
  const file=path.join(dir,'page.html');
  expect((await readCommand({values:{output:file},positionals:['PAGE12']},options)).source).toBe(file);
  version=4;const again=await readCommand({values:{output:file},positionals:['PAGE12']},options);
  expect(again.source).toBe(file);expect(again).not.toHaveProperty('note');expect(await readFile(file,'utf8')).toContain('v4');
  expect(sourceIdentity(await readFile(file,'utf8')).version).toBe(4);
  await writeFile(file,(await readFile(file,'utf8')).replace('v4','my edit'));version=5;
  const beside=await readCommand({values:{output:file},positionals:['PAGE12']},options);
  expect(beside.source).toBe(path.join(dir,'page.fresh.html'));expect(beside.note).toBe('page.html has changes of its own since it was read, so this read went to page.fresh.html: reapply what you need there, then publish that file.');
  expect(await readFile(file,'utf8')).toContain('my edit');expect(await readFile(beside.source,'utf8')).toContain('v5');
  expect((await readCommand({values:{output:file},positionals:['PAGE12']},options)).source).toBe(path.join(dir,'page.fresh-2.html'));
  await noCompanions(dir);
 }finally{await rm(dir,{recursive:true,force:true});}
});
