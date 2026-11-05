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
  await expect(graphqlCommand({sub:'mutate',values:{document,'idempotency-key':'k'},positionals:['PAGE12']},options)).rejects.toMatchObject({code:'idempotency_key_unsupported',exit:2});expect(writes).toBe(1);
  await writeFile(document,'mutation { unknownField }');await expect(graphqlCommand({sub:'mutate',values:{document},positionals:['PAGE12']},options)).rejects.toMatchObject({code:'graphql_validation'});expect(writes).toBe(1);
 }finally{await rm(root,{recursive:true,force:true});}
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
 // The digest names the screenshots it saved (M7).
 expect(passed).toContain('  screenshots: /tmp/390x844.png');
 // A clean pass of a published page ends with the Reply block and the watch line; this envelope has no reply facts (a local preview).
 expect(passed).toContain('clean pass on the local preview: no Reply block; a check of the published page prints it.');
 expect(passed).not.toMatch(/until the user stops|Verified:|Reply block \(/);
 const failed=checkDigest({ok:false,code:'check_failed',smokePassed:false,checks:[{viewport,...clean,pageErrors:['boom'],overflow:{viewport:390,content:512,fits:false},contrast:{checked:9,belowAA:2,unreadable:1,low:[{text:'Stop the loss',ratio:1.01,need:3}]},error:'Expected 7 labels'},{error:'session closed'}]},'qa.json');
 expect(failed).toContain('check check_failed: smoke failed');
 expect(failed).toMatch(/pageErrors 1: boom; overflow 512>390; contrast 2 below AA \(1 under 2:1; 1\.01:1 "Stop the loss".*\); task error: Expected 7 labels/);
 expect(failed).toContain('  session closed');
 // A guest run is labelled; a clean deck pass lists its slide images and says not to fetch them.
 const reply={id:'X',link:'https://h/a/X',builtWith:'one HTML page; Vega-Lite charts',permissions:[{id:'DATA12',name:'targets',lines:['Table public.targets','- Owner, editors: see and change everything.']}]};
 const guestDeck=checkDigest({ok:true,code:'completed',smokePassed:true,reply,slideLinks:['https://h/a/X/export?format=png&slide=1'],checks:[{viewport,...clean,overflow:{viewport:390,content:390,fits:true},contrast:{checked:1,belowAA:0,unreadable:0,low:[]},steps:true,task:{}},{viewport,viewer:'guest',...clean,overflow:{viewport:390,content:390,fits:true},contrast:{checked:1,belowAA:0,unreadable:0,low:[]},steps:true,task:{}}]},'qa.json');
 expect(guestDeck).toContain('  guest 390x844:');expect(guestDeck).toContain("  clean pass: nothing left to fix; don't open the qa JSON or fetch the slide images.\nReply block (send it as printed, up to the Next: line, unless the user prescribed the reply):\nhttps://h/a/X\n");expect(guestDeck).toContain('\nSlide images:\nhttps://h/a/X/export?format=png&slide=1\n');expect(guestDeck).not.toMatch(/curl/);
 // A passing run lists exactly the step labels it proved, per viewport, and what it did not, inside ONE Reply block (H10/H11).
 const proved=checkDigest({ok:true,code:'completed',smokePassed:true,reply,checks:[{viewport,...clean,overflow:{viewport:390,content:390,fits:true},contrast:{checked:1,belowAA:0,unreadable:0,low:[]},steps:{ran:true,passed:true},verified:['target saves']},{viewport,viewer:'guest',...clean,overflow:{viewport:390,content:390,fits:true},contrast:{checked:1,belowAA:0,unreadable:0,low:[]},steps:{ran:true,passed:true},verified:['guest reads it']}]},'qa.json');
 expect(proved).not.toContain('Verified');
 expect(proved.slice(proved.indexOf('Reply block'))).toBe(['Reply block (send it as printed, up to the Next: line, unless the user prescribed the reply):','https://h/a/X','Who can do what (copy these lines exactly; do not reword, bold or merge them):','Table public.targets','- Owner, editors: see and change everything.','Built with: one HTML page; Vega-Lite charts','Tested: 390x844: target saves | guest 390x844: guest reads it','Not tested: anything not listed in Tested:, visual appearance, and sharing between two signed-in users (the guest is signed out)','Next: when the request is done, send the Reply block above as text, word for word, adding no testing or build words of your own such as "end to end" or "verified" (only the URL if the user asked for only the URL), and, in that same response, run node scripts/comment.mjs watch X --next. Claude Code: start it with the Bash tool\'s run_in_background and end your turn with no further message; you are woken when it prints. Any other harness: run it as a blocking command and give your shell tool a timeout of at least 300000 ms; never wrap the command in timeout(1).',''].join('\n'));
 // Steps that proved no labelled behaviour still leave a true Tested: line, never an empty one.
 const bare=checkDigest({ok:true,code:'completed',smokePassed:true,reply,checks:[{viewport,...clean,overflow:{viewport:390,content:390,fits:true},contrast:{checked:1,belowAA:0,unreadable:0,low:[]},steps:{ran:true,passed:true}}]},'qa.json');
 expect(bare).toContain('\nTested: 390x844: the page loads without errors\n');expect(bare).not.toMatch(/Tested: \n/);
 // Several linked datasets each name themselves before their read-back lines.
 const two=checkDigest({ok:true,smokePassed:true,reply:{...reply,permissions:[...reply.permissions,{id:'DATA34',name:'rows',lines:['Table public.rows']}]},checks:[{viewport,...clean,overflow:{viewport:390,content:390,fits:true},contrast:{checked:1,belowAA:0,unreadable:0,low:[]},steps:true,verified:['a']}]});
 expect(two).toContain('Who can do what (copy these lines exactly; do not reword, bold or merge them):\ntargets (ref:DATA12):\nTable public.targets\n- Owner, editors: see and change everything.\nrows (ref:DATA34):\nTable public.rows\nBuilt with:');expect(two).toContain('check completed: smoke passed\n');
 // A failed or flawed run points at the summary itself, as a pass does.
 expect(failed).toContain("fix the named slides/elements from this output; don't open qa JSON.");expect(passed).not.toContain('fix the named');
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
it('checks a published file by its paired page and refuses an unpublished one',async()=>{
 const {mkdtemp,rm,writeFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {checkCommand}=await import('../../../skills/artifactbin/scripts/check.mjs');
 const dir=await mkdtemp(path.join(tmpdir(),'check-file-'));
 try{
  const file=path.join(dir,'index.html');await writeFile(file,'<p>Hi</p>');
  await expect(checkCommand({values:{},positionals:[file]},{env:{}})).rejects.toMatchObject({code:'unpublished_file'});
  await writeFile(file+'.af.json',JSON.stringify({id:'PAGE12',server:'https://pages.example'}));
  // The pair supplies id and server, so the hosted request goes to that server for /a/PAGE12.
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
  const planned=await publishCommand({values:{server,'dry-run':true,group:'@team'},positionals:[file]},options);
  expect(seen).toEqual(['/api/groups/team']);expect(planned).toMatchObject({dryRun:true,method:'POST',destination:{type:'group',id:'grp_team'}});
  expect(await publishCommand({values:{server,'dry-run':true},positionals:[file]},options)).not.toHaveProperty('destination');
  expect(await publishCommand({values:{server,'dry-run':true,personal:true},positionals:[file]},options)).toMatchObject({destination:{type:'personal'}});
  await expect(publishCommand({values:{server,'dry-run':true,personal:true,group:'team'},positionals:[file]},options)).rejects.toMatchObject({code:'invalid_destination'});
  role='viewer';
  await expect(publishCommand({values:{server,'dry-run':true,group:'team'},positionals:[file]},options)).rejects.toMatchObject({code:'group_not_editor'});
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
 // Every command (the autofix helper included) appears in the flows, each as a real invocation.
 const calls=[...flows.matchAll(/node scripts\/(\w+)\.mjs([^`&]*)[`&]/g)];
 for(const name of Object.keys(COMMANDS))expect(calls.some(call=>call[1]===name),name).toBe(true);
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
 for(const example of ['report','csv-dashboard','shared-app','deck']){
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
  await expect(publishCommand({values:{server,template:'read-only'},positionals:[csv]},options)).rejects.toMatchObject({code:'template_not_for_update'});
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
  await expect(publishCommand({values:{server,name:'renamed'},positionals:[csv]},options)).rejects.toMatchObject({code:'name_not_for_update',exit:2});
  expect(seen).toHaveLength(1);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('reads Built with from the page starter comment, and only datasets with a stored policy for who can do what',async()=>{
 const {builtWith,datasetLinks,replyFacts}=await import('../../../skills/artifactbin/scripts/toolbox-check-reply.mjs');
 const {readFile}=await import('node:fs/promises');
 const app=await readFile(new URL('../../../skills/artifactbin/examples/shared-app.html',import.meta.url),'utf8');
 expect(builtWith(app)).toMatch(/^one HTML page; .* through its generated API\.$/);expect(builtWith(app)).not.toContain('//');
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
  return Response.json({session_id:body.session_id,execution_id:body.execution_id,status:'completed',result:{viewport:{width:Number(size[1]),height:Number(size[2])},pageErrors:[],consoleErrors:[],failedRequests:[],httpErrors:[],telemetry:[],text:'Ready',overflow:{viewport:1,content:1,fits:true}}});};
 try{
  const result=await checkCommand({values:{},positionals:['PAGE12']},{env:{ARTIFACTBIN_URL:'https://h.test',ARTIFACTBIN_TOKEN:'t',ARTIFACTBIN_HOME:root},fetcher});
  expect(sizes.sort()).toEqual(['1200x630','1280x800']);
  expect(result.reply).toEqual({id:'PAGE12',link:'https://h.test/a/PAGE12',builtWith:'one HTML page from a SLIDES data block',permissions:[{id:'DATA12',name:'sales',lines:['Table public.sales','- Signed-out link holders: see rows.']}]});
  // An explicit --viewport wins.
  sizes.length=0;await checkCommand({values:{viewport:['390x844']},positionals:['PAGE12']},{env:{ARTIFACTBIN_URL:'https://h.test',ARTIFACTBIN_TOKEN:'t',ARTIFACTBIN_HOME:root},fetcher});
  expect(sizes).toEqual(['390x844']);
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
/** A fake server for publish/read: GET a page head, POST/PUT a page; every request is recorded. */
function fakePages(head:{id:string,version:number,state:string,html:string,format?:string,sharing_revision?:number}){
 const sent:any[]=[];
 const fetcher=async(input:any,init:any)=>{const url=new URL(String(input)),method=init?.method??'GET',body=init?.body?JSON.parse(String(init.body)):undefined;sent.push({method,path:url.pathname,body});
  if(method==='GET')return Response.json({format:'html',sharing_revision:0,...head});
  const version=method==='PUT'?head.version+1:1;
  return Response.json({id:method==='PUT'?url.pathname.split('/').at(-1):'NEW123',url:'https://h.test/a/X',version,state:'c'.repeat(64),html:body.html,format:'html'},{status:method==='PUT'?200:201});};
 return {sent,fetcher};
}
it('publish refuses an empty page and starter placeholders by line, and drops hand-written ids on a new page',async()=>{
 const {mkdtemp,rm,writeFile,readFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {publishCommand}=await import('../../../skills/artifactbin/scripts/toolbox-publish.mjs');
 const home=await mkdtemp(path.join(tmpdir(),'publish-guard-')),dir=path.join(home,'project');await (await import('node:fs/promises')).mkdir(dir);const {sent,fetcher}=fakePages({id:'PAGE12',version:3,state:'a'.repeat(64),html:''});
 const options={env:{ARTIFACTBIN_URL:'https://h.test',ARTIFACTBIN_TOKEN:'t',ARTIFACTBIN_HOME:path.join(home,'home')},fetcher,log:()=>{}};
 try{
  const file=path.join(dir,'index.html');
  for(const empty of ['','\n  \n','<!doctype html><html><head><title>x</title></head><body>\n</body></html>']){
   await writeFile(file,empty);
   await expect(publishCommand({values:{},positionals:[file]},options)).rejects.toMatchObject({code:'empty_page',exit:2,recovery:expect.stringContaining('Write the page into index.html')});
  }
  await writeFile(file,'<!doctype html>\n<title>[Household budget]</title>\n<link rel="af-dataset" data-af-name="t" href="ref:DATASET_ID">\n<p>Hi</p>');
  const refused=await publishCommand({values:{},positionals:[file]},options).catch((error:any)=>error);
  expect(refused).toMatchObject({code:'autofix_refused'});
  expect(refused.details.autofix.problems.map((p:any)=>[p.rule,p.line])).toEqual([['starter-placeholder',2],['starter-placeholder',3]]);
  expect(refused.details.autofix.report).toContain('ref:DATASET_ID is a starter placeholder: publish that data first');
  expect(refused.details.autofix.report).toContain('starter placeholder [Household budget] is still in the page');
  expect(sent).toEqual([]);
  // A new page with hand-written and repeated data-af-ids publishes; none of them is sent.
  await writeFile(file,'<!doctype html>\n<h1 data-af-id="hero">Hi</h1><p data-af-id="hero">Lede</p>');
  const done=await publishCommand({values:{},positionals:[file]},options);
  expect(sent.at(-1).method).toBe('POST');expect(sent.at(-1).body.html).not.toContain('data-af-id="hero"');
  expect(done.autofix.routine).toContain('dropped 2 hand-written data-af-id (the platform assigns them)');
  expect(done.next).toBe('Next: when the request is done, send your reply (the URL as asked) as text and, in that same response, run node scripts/comment.mjs watch NEW123 --next. Claude Code: start it with the Bash tool\'s run_in_background and end your turn with no further message; you are woken when it prints. Any other harness: run it as a blocking command and give your shell tool a timeout of at least 300000 ms; never wrap the command in timeout(1).');
  expect(JSON.parse(await readFile(file+'.af.json','utf8')).id).toBe('NEW123');
 }finally{await rm(home,{recursive:true,force:true});}
});
it('publish FILE --artifact ID replaces that page over its current head when the file has no usable companion',async()=>{
 const {mkdtemp,rm,writeFile,readFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {publishCommand}=await import('../../../skills/artifactbin/scripts/toolbox-publish.mjs');
 const home=await mkdtemp(path.join(tmpdir(),'publish-artifact-')),dir=path.join(home,'project');await (await import('node:fs/promises')).mkdir(dir);const {sent,fetcher}=fakePages({id:'PAGE12',version:3,state:'a'.repeat(64),html:'<h1 data-af-id="af-1">Old</h1>',sharing_revision:4});
 const options={env:{ARTIFACTBIN_URL:'https://h.test',ARTIFACTBIN_TOKEN:'t',ARTIFACTBIN_HOME:path.join(home,'home')},fetcher,log:()=>{}};
 try{
  const file=path.join(dir,'index.html');await writeFile(file,'<!doctype html>\n<h1 data-af-id="af-1">New</h1>');
  const done=await publishCommand({values:{artifact:'PAGE12',visibility:'public'},positionals:[file]},options);
  expect(sent.map(r=>r.method+' '+r.path)).toEqual(['GET /api/artifacts/PAGE12','PUT /api/artifacts/PAGE12']);
  // The head is the baseline; ids are carried as written; a visibility change names the sharing revision read with it.
  expect(sent[1].body).toMatchObject({expectedVersion:3,expectedState:'a'.repeat(64),expectedSharingRevision:4,visibility:'public'});
  expect(sent[1].body.html).toContain('data-af-id="af-1"');
  expect(done).toMatchObject({id:'PAGE12',version:4,updatedInPlace:true,note:'index.html replaced page PAGE12 (its version 3 was the baseline).'});
  expect(JSON.parse(await readFile(file+'.af.json','utf8'))).toMatchObject({id:'PAGE12',version:4});
  // Overwritten later (a starter copied over it): the refusal names the real cause and the one recovery.
  await writeFile(file,'<!doctype html>\n<h1>Starter</h1>');
  const refused=await publishCommand({values:{},positionals:[file]},options).catch((error:any)=>error);
  expect(refused).toMatchObject({code:'invalid_baseline',message:'index.html was overwritten after it was saved (its af-authoring marker no longer matches index.html.af.json), so publish cannot tell what it replaces.'});
  expect(refused.recovery).toContain('node scripts/publish.mjs index.html --artifact PAGE12');
  // With --artifact the same file recovers by itself.
  sent.length=0;
  expect(await publishCommand({values:{artifact:'PAGE12'},positionals:[file]},options)).toMatchObject({id:'PAGE12'});
  expect(sent.map(r=>r.method)).toEqual(['GET','PUT']);expect(sent[1].body).not.toHaveProperty('expectedSharingRevision');
  // A companion that belongs to the named page is the baseline itself: no head read.
  sent.length=0;await writeFile(file,(await readFile(file,'utf8')).replace('Starter','Edited'));
  await publishCommand({values:{artifact:'PAGE12'},positionals:[file]},options);expect(sent.map(r=>r.method)).toEqual(['PUT']);
  await expect(publishCommand({values:{artifact:'PAGE12',group:'team'},positionals:[path.join(dir,'index.html')]},{...options,fetcher:async()=>Response.json({format:'html',id:'OTHER1',version:1,state:'a'.repeat(64)})})).rejects.toMatchObject({code:'group_not_for_update'});
 }finally{await rm(home,{recursive:true,force:true});}
});
it('read --output refreshes an unchanged pair in place and saves beside a file with edits of its own',async()=>{
 const {mkdtemp,rm,writeFile,readFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {readCommand}=await import('../../../skills/artifactbin/scripts/read.mjs');
 const dir=await mkdtemp(path.join(tmpdir(),'read-refresh-'));let version=3;
 const options={env:{ARTIFACTBIN_URL:'https://h.test',ARTIFACTBIN_TOKEN:'t'},fetcher:async()=>Response.json({id:'PAGE12',format:'html',version,state:'a'.repeat(64),html:`<h1 data-af-id="h">v${version}</h1>`})};
 try{
  const file=path.join(dir,'page.html');
  expect((await readCommand({values:{output:file},positionals:['PAGE12']},options)).source).toBe(file);
  version=4;const again=await readCommand({values:{output:file},positionals:['PAGE12']},options);
  expect(again.source).toBe(file);expect(again).not.toHaveProperty('note');expect(await readFile(file,'utf8')).toContain('v4');
  expect(JSON.parse(await readFile(file+'.af.json','utf8')).version).toBe(4);
  await writeFile(file,(await readFile(file,'utf8')).replace('v4','my edit'));version=5;
  const beside=await readCommand({values:{output:file},positionals:['PAGE12']},options);
  expect(beside.source).toBe(path.join(dir,'page.fresh.html'));expect(beside.note).toBe('page.html has changes of its own since it was read, so this read went to page.fresh.html: reapply what you need there, then publish that file.');
  expect(await readFile(file,'utf8')).toContain('my edit');expect(await readFile(beside.source,'utf8')).toContain('v5');
  expect((await readCommand({values:{output:file},positionals:['PAGE12']},options)).source).toBe(path.join(dir,'page.fresh-2.html'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
