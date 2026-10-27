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
 const passed=checkDigest({ok:true,code:'completed',smokePassed:true,checks:[{viewport,...clean,overflow:{viewport:390,content:390,fits:true},contrast:{checked:12,belowAA:0,unreadable:0,low:[]},task:{total:42},screenshot:{path:'/tmp/390x844.png'}}],unverified:['visual appearance']},'qa.json');
 expect(passed.split('\n').slice(0,3)).toEqual(['check completed: smoke passed; full result qa.json','  390x844: no errors; fits; contrast ok; task {"total":42}; screenshot /tmp/390x844.png','  unverified: visual appearance']);
 // Only a fully clean pass tells the author they may stop.
 expect(passed).toMatch(/clean pass: .*stop/);
 const failed=checkDigest({ok:false,code:'check_failed',smokePassed:false,checks:[{viewport,...clean,pageErrors:['boom'],overflow:{viewport:390,content:512,fits:false},contrast:{checked:9,belowAA:2,unreadable:1,low:[{text:'Stop the loss',ratio:1.01,need:3}]},error:'Expected 7 labels'},{error:'session closed'}]},'qa.json');
 expect(failed).toContain('check check_failed: smoke failed');
 expect(failed).toContain('pageErrors 1: boom; overflow 512>390; contrast 2 below AA (1 under 2:1; worst 1.01:1 "Stop the loss"); task error: Expected 7 labels');
 expect(failed).toContain('  session closed');
 const deck=checkDigest({ok:true,code:'completed',smokePassed:true,checks:[{viewport:{width:1200,height:630},...clean,overflow:{viewport:1200,content:1200,fits:true},contrast:{checked:30,belowAA:0,unreadable:0,low:[]},slides:{count:8,clipped:2,items:[{slide:8,text:'7.5k',px:53,by:'div.milestones'}],overlapping:1,overlaps:[{slide:2,text:'02',over:'Header label'}]}}]},'qa.json');
 expect(deck).toContain('contrast ok; slides 8 exportable, 2 clipped (slide 8 "7.5k" by div.milestones 53px), 1 overlapping (slide 2 "02" over "Header label"); no task');
 expect(passed).not.toContain('slides');
 expect(failed).not.toContain('clean pass');
 expect(deck).not.toContain('clean pass');
});
