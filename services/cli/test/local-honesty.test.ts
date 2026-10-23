/**
 * Every CLI command on a local workspace file works offline or refuses clearly: none reaches a server,
 * starts a sign-in, or reports work it did not do. Each test runs the real dispatcher with a fetch that
 * records and refuses every request, so "offline" is an observation, not a claim.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,win32} from 'node:path';
import {runCli} from '../src/dispatch';
import {digest} from '../src/files';
import {saveLocalFile,localWorkspaceState,LOCAL_WORKSPACE_SCOPE,workspaceCandidates,type DiscoveryHost} from '../src/local-workspace';
import {previewAnnotations} from '../src/preview/annotations';
import {parseDocument} from '../src/document';
import {loadWorkspace,saveTracking} from '../src/workspace';

async function sandbox(run:(root:string,home:string)=>Promise<void>){
 const parent=await realpath(await mkdtemp(join(tmpdir(),'afbin-honest-'))),root=join(parent,'work'),home=join(parent,'home');
 await mkdir(root);await mkdir(home);
 try{await run(root,home);}finally{await rm(parent,{recursive:true,force:true});}
}
async function cli(cwd:string,home:string,args:string[]){
 const out:string[]=[],err:string[]=[],sent:string[]=[];
 const code=await runCli(args,{cwd,home,env:{ARTIFACTBIN_SKILLS:'off'},interactive:false,stdout:s=>out.push(s),stderr:s=>err.push(s),
  fetch:async input=>{sent.push(String(input));throw new Error(`offline test: ${String(input)}`);}});
 const text=out.join('');let json:any;try{json=JSON.parse(text);}catch{json=undefined;}
 return {code,out:text,err:err.join(''),sent,json};
}
const DOC='<article id="story"><p id="para">Keep this finding.</p></article>\n';

test('delete --type comment on a local file deletes the local reply or thread offline, and listings agree',()=>sandbox(async(root,home)=>{
 await writeFile(join(root,'doc.jsx'),DOC);assert.equal((await cli(root,home,['add','doc.jsx','--json'])).code,0);
 const thread=await cli(root,home,['comment','doc.jsx','--node','para','--body','First','--json']);assert.equal(thread.code,0,thread.out+thread.err);
 const replied=await cli(root,home,['comment','doc.jsx','--thread',thread.json.id,'--body','Second','--json']);assert.equal(replied.code,0,replied.out+replied.err);
 const reply=replied.json.thread[1].id;
 const planned=await cli(root,home,['delete','--type','comment','--in','doc.jsx',reply,'--dry-run','--json']);
 assert.equal(planned.code,0,planned.out+planned.err);assert.deepEqual(planned.json.operations.map((op:any)=>op.status),['would_delete']);
 const removed=await cli(root,home,['delete','--type','comment','--in','doc.jsx',reply,'--json']);
 assert.equal(removed.code,0,removed.out+removed.err);assert.equal(removed.json.local,true);assert.deepEqual(removed.json.operations.map((op:any)=>[op.id,op.status]),[[reply,'deleted']]);
 const listed=await cli(root,home,['comment','doc.jsx','--json']);
 assert.deepEqual(listed.json.annotations.map((a:any)=>a.thread.map((c:any)=>c.body)),[['First']]);
 // The preview's own annotation store reads the same state.
 const preview=previewAnnotations(await localWorkspaceState(root),LOCAL_WORKSPACE_SCOPE,'doc.jsx',parseDocument(await readFile(join(root,'doc.jsx'),'utf8')).body);
 assert.deepEqual(preview.list('open').map(a=>a.thread.length),[1]);
 const gone=await cli(root,home,['delete','--type','comment','--in','doc.jsx',thread.json.id,'--json']);assert.equal(gone.code,0,gone.out+gone.err);
 assert.deepEqual((await cli(root,home,['comment','doc.jsx','--filter','state=all','--json'])).json.annotations,[]);
 const unknown=await cli(root,home,['delete','--type','comment','--in','doc.jsx','missing_thread','--json']);
 assert.equal(unknown.code,1);assert.equal(unknown.json.operations[0].error.code,'invalid_thread');
 for(const run of [planned,removed,gone,unknown])assert.deepEqual(run.sent,[],'local comment deletion never reaches a server');
}));

test('validate runs the local query dry-run and chart-column checks it reports, and catches a SQL syntax error',()=>sandbox(async(root,home)=>{
 await writeFile(join(root,'rows.csv'),'day,high\nMon,60\nTue,70\n');
 const added=await cli(root,home,['add','rows.csv','--json']);assert.equal(added.code,0,added.out+added.err);
 const data=added.json['rows.csv'];
 const doc=(sql:string,field='high')=>`---\ntitle: Weather\n---\n<Helmet><Import name="w" src="ref:${data}" /><Query name="forecast">{\`${sql}\`}</Query></Helmet><article><Question data="$forecast" viz={{"kind":"vega-lite","spec":{"mark":"line","encoding":{"x":{"field":"day","type":"nominal"},"y":{"field":"${field}","type":"quantitative"}}}}} /></article>\n`;
 await writeFile(join(root,'bad.jsx'),doc('select x as day, 1 as high from (values (1)) as t(x)'));
 const bad=await cli(root,home,['validate','bad.jsx','--json']);
 assert.equal(bad.code,2,bad.out+bad.err);assert.equal(bad.json.valid,false);
 assert.match(JSON.stringify(bad.json.files[0].diagnostics),/near \\"\(\\": syntax error/);
 assert.doesNotMatch(bad.out,/published dataset/);
 await writeFile(join(root,'chart.jsx'),doc('select day, high from w.rows','nope'));
 const chart=await cli(root,home,['validate','chart.jsx','--json']);
 assert.equal(chart.code,2,chart.out+chart.err);assert.match(JSON.stringify(chart.json.files[0].diagnostics),/encoding field \\"nope\\" is not a column/);
 await writeFile(join(root,'good.jsx'),doc('select day, high from w.rows'));
 const good=await cli(root,home,['validate','good.jsx','--json']);
 assert.equal(good.code,0,good.out+good.err);
 assert.deepEqual(good.json.verified,[{path:'good.jsx',title:'Weather',queries:['forecast'],charts:1,checks:['markup validated','1 query ran locally against workspace data','1 chart checked against local query columns','server checks not run; afbin validate --remote adds them']}]);
 for(const run of [bad,chart,good])assert.deepEqual(run.sent,[]);
}));

test('validate says which queries it could not run instead of claiming them',()=>sandbox(async(root,home)=>{
 await writeFile(join(root,'doc.jsx'),'---\ntitle: Remote data\n---\n<Helmet><Import name="w" src="ref:abc123" /><Query name="q">{`select * from w.rows`}</Query></Helmet><article><p>Hi</p></article>\n');
 const result=await cli(root,home,['validate','doc.jsx','--json']);
 assert.equal(result.code,0,result.out+result.err);
 assert.deepEqual(result.json.verified[0].checks,['markup validated','1 query not run: dataset abc123 has no local copy (afbin pull abc123)','server checks not run; afbin validate --remote adds them']);
 assert.deepEqual(result.sent,[]);
}));

test('a local query failure points at the SQL, not back at validate',()=>sandbox(async(root,home)=>{
 await writeFile(join(root,'doc.jsx'),'<Helmet><Query name="q">{`select x from (values (1)) as t(x)`}</Query></Helmet><p>Hi</p>\n');
 const result=await cli(root,home,['query','doc.jsx','--name','q','--json']);
 assert.equal(result.json.error.code,'invalid_query');assert.doesNotMatch(result.json.error.fix??'',/afbin validate/);
}));

test('open on a never-published local file refuses instead of printing a link that does not exist',()=>sandbox(async(root,home)=>{
 await writeFile(join(root,'doc.jsx'),DOC);
 assert.equal((await cli(root,home,['add','doc.jsx','--json'])).code,0);
 const opened=await cli(root,home,['open','doc.jsx','--json']);
 assert.notEqual(opened.code,0);assert.equal(opened.json.error.code,'unpublished_draft',opened.out);
 assert.match(opened.json.error.fix,/afbin preview doc\.jsx/);assert.doesNotMatch(opened.out,/\/a\//);
 assert.deepEqual(opened.sent,[]);
}));

test('list in an untracked local workspace without a sign-in lists local files and never starts device sign-in',()=>sandbox(async(root,home)=>{
 await writeFile(join(root,'doc.jsx'),'---\ntitle: Local doc\n---\n'+DOC);
 assert.equal((await cli(root,home,['add','doc.jsx','--json'])).code,0);
 const listed=await cli(root,home,['list','--json']);
 assert.equal(listed.code,0,listed.out+listed.err);assert.equal(listed.json.local,true);assert.equal(listed.json.root,root);
 assert.deepEqual(listed.json.artifacts.map((a:any)=>[a.path,a.title,a.published]),[['doc.jsx','Local doc',false]]);
 assert.match(listed.json.remote,/afbin auth/);
 const sessions=await cli(root,home,['list','--type','session','--json']);
 assert.equal(sessions.json.error.code,'auth_required');assert.match(sessions.json.error.fix,/afbin auth/);
 for(const run of [listed,sessions])assert.deepEqual(run.sent,[],'no sign-in or identity request');
}));

test('diff file@N reads the local version log shows, and log stays compact unless --full asks for source',()=>sandbox(async(root,home)=>{
 await writeFile(join(root,'doc.jsx'),DOC);
 assert.equal((await cli(root,home,['add','doc.jsx','--json'])).code,0);
 for(const words of ['Second draft.','Third draft.']){
  const before=await readFile(join(root,'doc.jsx'));
  await saveLocalFile(root,'doc.jsx',digest(before),Buffer.from(before.toString().replace(/<p id="para">[^<]*/,`<p id="para">${words}`)));
 }
 const log=await cli(root,home,['log','doc.jsx','--json']);
 assert.equal(log.code,0,log.out+log.err);assert.deepEqual(log.json.versions.map((v:any)=>v.version),[2,1]);
 for(const version of log.json.versions){assert.equal(version.source,undefined);assert.equal(version.body,undefined);assert.equal(typeof version.revision,'string');}
 const full=await cli(root,home,['log','doc.jsx','--full','--json']);
 assert.match(full.json.versions[1].source,/Keep this finding/);
 const diff=await cli(root,home,['diff','doc.jsx@1','--json']);
 assert.equal(diff.code,0,diff.out+diff.err);
 assert.match(diff.json.diffs[0].diff,/-<article id="story"><p id="para">Keep this finding\./);assert.match(diff.json.diffs[0].diff,/\+<article id="story"><p id="para">Third draft\./);
 assert.match(diff.json.diffs[0].diff,/local version 1/);
 for(const run of [log,full,diff])assert.deepEqual(run.sent,[]);
}));

test('workspace discovery stops at a git root and at HOME, and names an ancestor workspace it adopts',()=>sandbox(async(root,home)=>{
 await writeFile(join(root,'doc.jsx'),DOC);assert.equal((await cli(root,home,['add','doc.jsx','--json'])).code,0);
 const nested=join(root,'notes','deep');await mkdir(nested,{recursive:true});
 const adopted=await cli(nested,home,['status','--json']);
 assert.equal(adopted.code,0,adopted.out+adopted.err);assert.match(adopted.err,new RegExp(`Workspace: ${root.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`));
 assert.deepEqual(adopted.json.files.map((f:any)=>f.path),['doc.jsx']);
 const repo=join(root,'repo'),inside=join(repo,'src');await mkdir(join(repo,'.git'),{recursive:true});await mkdir(inside);
 assert.equal((await loadWorkspace(inside,home)).root,inside,'a git repository is its own boundary');
 assert.equal((await loadWorkspace(repo,home)).root,repo);
 // A marker at HOME is the CLI's own state directory, never an ancestor's workspace.
 await writeFile(join(home,'doc.jsx'),DOC);assert.equal((await cli(home,home,['add','doc.jsx','--json'])).code,0);
 const below=join(home,'projects');await mkdir(below);
 assert.equal((await loadWorkspace(below,home)).root,below);
}));

test('CLI comments without --agent are attributed to the CLI, not to the browser user',()=>sandbox(async(root,home)=>{
 await writeFile(join(root,'doc.jsx'),DOC);assert.equal((await cli(root,home,['add','doc.jsx','--json'])).code,0);
 const created=await cli(root,home,['comment','doc.jsx','--node','para','--body','From the terminal','--json']);
 assert.equal(created.code,0,created.out+created.err);
 const author=created.json.thread[0].author;
 assert.equal(author.kind,'agent');assert.notEqual(author.transport,'browser');assert.notEqual(author.label,'You');
}));

test('a local .jsx in a directory that is not yet a workspace takes comments offline, as add or preview would make it',()=>sandbox(async(root,home)=>{
 await writeFile(join(root,'doc.jsx'),DOC);
 const created=await cli(root,home,['comment','doc.jsx','--node','para','--body','First note','--json']);
 assert.equal(created.code,0,created.out+created.err);assert.equal(created.json.local,true);assert.equal(created.json.thread[0].body,'First note');
 const listed=await cli(root,home,['comment','doc.jsx','--json']);
 assert.deepEqual(listed.json.annotations.map((a:any)=>a.thread[0].body),['First note']);
 assert.equal((await loadWorkspace(root,home)).root,root,'the directory is now the workspace');
 for(const run of [created,listed])assert.deepEqual(run.sent,[]);
}));

test('the home-store workspace climb stops at a git root and at HOME, like the marker climb',()=>sandbox(async(root,home)=>{
 await saveTracking(await loadWorkspace(root,home),{server:'https://one.example',account:'usr_one'});
 const nested=join(root,'notes');await mkdir(nested);
 assert.equal((await loadWorkspace(nested,home)).root,root,'an ordinary subdirectory still finds its workspace');
 const repo=join(root,'repo'),inside=join(repo,'src');await mkdir(join(repo,'.git'),{recursive:true});await mkdir(inside);
 const bounded=await loadWorkspace(inside,home);assert.equal(bounded.root,inside);assert.equal(bounded.tracking,null);
 await saveTracking(await loadWorkspace(home,home),{server:'https://one.example',account:'usr_one'});
 const below=join(home,'projects');await mkdir(below);
 const underHome=await loadWorkspace(below,home);assert.equal(underHome.root,below);assert.equal(underHome.tracking,null);
}));

test('bounded discovery holds for Windows path forms: 8.3 temp names, drive-letter case, \\\\?\\ prefixes, drive roots, .git files, unreadable ancestors',async()=>{
 const long='C:\\Users\\runneradmin\\AppData\\Local\\Temp';
 const aliases:Record<string,string>={'c:\\users\\runner~1\\appdata\\local\\temp':long,'\\\\?\\c:\\users\\runneradmin\\appdata\\local\\temp':long};
 const host=(over:Partial<DiscoveryHost>={}):DiscoveryHost=>({path:win32,
  realpath:async p=>{const k=p.toLowerCase();for(const [alias,target] of Object.entries(aliases))if(k===alias||k.startsWith(alias+'\\'))return target+p.slice(alias.length);return p;},
  owner:async()=>undefined,isGit:async()=>false,boundaries:['C:\\Users\\RUNNER~1\\AppData\\Local\\Temp','c:\\users\\runneradmin'],...over});
 // The 8.3 temp name and the long realpath are one boundary; the drive letter's case does not matter.
 assert.deepEqual(await workspaceCandidates('c:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\ws\\sub',undefined,host()),[`${long}\\ws\\sub`,`${long}\\ws`]);
 assert.deepEqual(await workspaceCandidates('\\\\?\\C:\\Users\\runneradmin\\AppData\\Local\\Temp\\ws',undefined,host()),[`${long}\\ws`]);
 assert.deepEqual(await workspaceCandidates('C:\\Users\\runneradmin\\projects\\doc',undefined,host()),['C:\\Users\\runneradmin\\projects\\doc','C:\\Users\\runneradmin\\projects'],'HOME in another case still bounds');
 // A drive root ends the climb; D:\ has no boundary at all.
 assert.deepEqual(await workspaceCandidates('D:\\a\\b',undefined,host()),['D:\\a\\b','D:\\a','D:\\']);
 // A .git FILE (a git worktree) is a repository root too.
 assert.deepEqual(await workspaceCandidates('D:\\repo\\src',undefined,host({isGit:async p=>p==='D:\\repo'})),['D:\\repo\\src','D:\\repo']);
 // An ancestor that cannot be inspected bounds the climb instead of failing the command.
 assert.deepEqual(await workspaceCandidates('D:\\a\\b',undefined,host({owner:async p=>{if(p==='D:\\a')throw Object.assign(new Error('EPERM'),{code:'EPERM'});return undefined;},isGit:async p=>{if(p==='D:\\a')throw Object.assign(new Error('EPERM'),{code:'EPERM'});return false;}})),['D:\\a\\b']);
});
