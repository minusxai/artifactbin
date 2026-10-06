import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {automaticUpdate} from '../src/auto-update';
import {autoUpdatePolicy,setClientDefault} from '../src/config';
import {runCli} from '../src/dispatch';
import {saveTestConnection,seedIdentityPool} from './connection';
import {parseDocument} from '../src/document';
import {digest} from '../src/files';
import {createDocumentGraph} from '../../app/lib/story/graph/document-graph';
import {automaticInstallPrefix,defaultNpm,type NpmRunner} from '../src/global-install';

const release={version:'9.8.7',protocol:3};
async function fixture(){
 const home=await mkdtemp(join(tmpdir(),'afbin-auto-update-')),prefix=join(home,'prefix');
 const entry=join(prefix,'lib','node_modules','@afbin','cli','dist','afbin.mjs');
 await mkdir(join(prefix,'lib','node_modules','@afbin','cli','dist'),{recursive:true});await writeFile(entry,'');
 return {home,prefix,entry,env:{ARTIFACTBIN_HOME:join(home,'.artifactbin'),ARTIFACTBIN_SKILLS:'off'},clean:()=>rm(home,{recursive:true,force:true})};
}
test('disable env defaults false, explicit true disables, and legacy/offline/pin exclusions remain',()=>{
 assert.equal(autoUpdatePolicy({}).enabled,true);
 for(const value of ['true','TRUE','1'])assert.equal(autoUpdatePolicy({CLI__DISABLE_AUTO_UPDATES:value}).enabled,false);
 for(const value of ['false','0'])assert.equal(autoUpdatePolicy({CLI__DISABLE_AUTO_UPDATES:value}).enabled,true);
 for(const env of [{CLI__AUTO_UPDATE:'off'},{npm_config_offline:'true'},{CLI__VERSION_PIN:'9.8.7'}])assert.equal(autoUpdatePolicy(env).enabled,false);
});
test('observe never installs; finish installs exact release once per hour, with a bounded npm call',async()=>{
 const f=await fixture(),calls:string[][]=[],messages:string[]=[];let now=1000;
 const npm:NpmRunner=async(args,options)=>{calls.push(args);assert.ok(options.timeoutMs!>0&&options.timeoutMs!<=120000);return {code:0,stdout:args[0]==='prefix'?f.prefix+'\n':'',stderr:''};};
 try{
  const make=()=>automaticUpdate({...f,npm,stderr:s=>messages.push(s),now:()=>now,currentVersion:'1.0.0'});
  const first=make();await first.observe(release);assert.equal(calls.length,0);await first.finish();
  assert.deepEqual(calls,[['prefix','-g'],['install','-g','--prefix',f.prefix,'--no-fund','--no-audit','@afbin/cli@9.8.7']]);
  assert.match(messages.join(''),/Updated afbin to 9.8.7/);
  calls.length=0;const second=make();await second.observe(release);await second.finish();assert.ok(calls.every(args=>args[0]!=='install'));
  now+=3600001;const third=make();await third.observe(release);await third.finish();assert.equal(calls.filter(args=>args[0]==='install').length,1);
 }finally{await f.clean();}
});
test('opt-out, offline, pins, managed worker and dev skip npm entirely',async()=>{
 const f=await fixture();
 try{
  for(const extra of [{env:{...f.env,CLI__DISABLE_AUTO_UPDATES:'true'}},{env:{...f.env,npm_config_offline:'true'}},{env:{...f.env,CLI__VERSION_PIN:'1.0.0'}},{env:{...f.env,ARTIFACTBIN_GLOBAL:'off'}},{env:{...f.env,ARTIFACTBIN__REMOTE_SESSION:'rs_one',ARTIFACTBIN__REMOTE_PROOF:'test-proof'}},{entry:join(f.home,'checkout','dist','afbin.mjs')}]){
   const updater=automaticUpdate({...f,...extra,npm:async()=>assert.fail('excluded update ran npm'),stderr:()=>{}});await updater.observe(release);await updater.finish();
  }
 }finally{await f.clean();}
});
test('npx and project installs do not change the global install; invalid/equal/older releases do nothing',async()=>{
 const f=await fixture(),calls:string[][]=[];
 const npm:NpmRunner=async args=>{calls.push(args);return {code:0,stdout:f.prefix+'\n',stderr:''};};
 try{
  for(const entry of [join(f.home,'cache','_npx','hash','node_modules','@afbin','cli','dist','afbin.mjs'),join(f.home,'project','node_modules','@afbin','cli','dist','afbin.mjs')]){
   const updater=automaticUpdate({...f,entry,npm,stderr:()=>{}});await updater.observe(release);await updater.finish();
  }
  assert.ok(calls.every(args=>args[0]!=='install'));calls.length=0;
  for(const data of [{version:'9.8.7;evil',protocol:3},{version:'1.0.0',protocol:3},{version:'0.9.0',protocol:3},{version:'9.8.7',protocol:0}]){
   const updater=automaticUpdate({...f,npm,stderr:()=>{},currentVersion:'1.0.0'});await updater.observe(data);await updater.finish();
  }
  assert.equal(calls.length,0);
 }finally{await f.clean();}
});
test('concurrent finishes perform one install; failure is throttled and reported without throwing',async()=>{
 const f=await fixture();let installs=0;let releaseInstall!:()=>void;
 const started=new Promise<void>(resolve=>releaseInstall=resolve);let finishInstall!:()=>void;
 const held=new Promise<void>(resolve=>finishInstall=resolve);
 const npm:NpmRunner=async args=>{if(args[0]==='prefix')return {code:0,stdout:f.prefix+'\n',stderr:''};installs++;releaseInstall();await held;return {code:1,stdout:'',stderr:'npm error code ENOTFOUND'};};
 const messages:string[]=[];
 try{
  const make=()=>automaticUpdate({...f,npm,stderr:s=>messages.push(s)});const one=make(),two=make();await one.observe(release);await two.observe(release);
  const pending=one.finish();await started;await two.finish();finishInstall();await pending;assert.equal(installs,1);assert.match(messages.join(''),/Automatic update failed/);
  const three=make();await three.observe(release);await three.finish();assert.equal(installs,1);
 }finally{finishInstall?.();await f.clean();}
});
test('a push saves canonical source and prints success before installing; npm failure never changes its result',async()=>{
 const f=await fixture(),out:string[]=[],errors:string[]=[],events:string[]=[];let writes=0;
 const cwd=join(f.home,'work');await mkdir(cwd);const source=join(cwd,'doc.jsx');
 const markup='<p id="p001">Published</p>',head={id:'abc123',version:1,edit_id:'edit1',state:digest('state1'),markup,document:createDocumentGraph(markup,1),format:'markup',url:'https://example.test/a/abc123'};
 const npm:NpmRunner=async args=>{
  events.push(args[0]!);assert.equal(JSON.parse(out.join('')).operations[0].status,'published');
  const saved=parseDocument(await readFile(source,'utf8'));assert.equal(saved.metadata.id,'abc123');assert.equal(saved.metadata.edit_id,'edit1');assert.match(saved.body,/id="p001"/);
  return args[0]==='prefix'?{code:0,stdout:f.prefix+'\n',stderr:''}:{code:1,stdout:'',stderr:'npm error code ENOTFOUND'};
 };
 try{
  await saveTestConnection({server:'https://example.test',token:'mx_test'},f.home,f.env);await seedIdentityPool(f.home,cwd,['abc123'],'usr_one','https://example.test');await writeFile(source,'<p>Published</p>');
  const code=await runCli(['push','doc.jsx','--json'],{home:f.home,cwd,env:f.env,entry:f.entry,npm,interactive:false,stdout:s=>{out.push(s);events.push('result');},stderr:s=>errors.push(s),fetch:async(input,init)=>{
   assert.equal(new URL(String(input)).pathname,'/api/artifacts');assert.equal(init?.method,'POST');writes++;
   return Response.json(head,{status:201,headers:{'X-Artifactbin-Account':'usr_one','X-Artifactbin-CLI-Version':release.version,'X-Artifactbin-Protocol':'3'}});
  }});
  assert.equal(code,0,out.join(''));assert.equal(writes,1);assert.deepEqual(events,['result','prefix','install']);assert.match(errors.join(''),/Automatic update failed/);
 }finally{await f.clean();}
});
test('failed remote commands and dry runs never install even when their replies advertise an update',async()=>{
 const f=await fixture();
 try{
  await saveTestConnection({server:'https://example.test',token:'mx_test'},f.home,f.env);
  for(const args of [['list','--type','profile'],['push','--dry-run']]){
   const output:string[]=[];await runCli([...args,'--json'],{home:f.home,cwd:f.home,env:f.env,entry:f.entry,npm:async()=>assert.fail('failed/dry command installed'),interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async()=>Response.json({error:'forbidden'},{status:403,headers:{'X-Artifactbin-CLI-Version':release.version,'X-Artifactbin-Protocol':'3'}})});
  }
 }finally{await f.clean();}
});

test('saved opt-out and absent metadata never install',async()=>{
 const f=await fixture();
 try{
  await setClientDefault('updates','false',f.home,f.env);
  const updater=automaticUpdate({...f,npm:async()=>assert.fail('saved opt-out ran npm'),stderr:()=>{}});await updater.observe(release);await updater.finish();
  const none=automaticUpdate({...f,npm:async()=>assert.fail('no release ran npm'),stderr:()=>{}});await none.finish();
 }finally{await f.clean();}
});
test('setup private prefix and Windows global prefix are updated in place',async()=>{
 const f=await fixture();
 try{
  const prefix=join(f.home,'.artifactbin','npm'),entry=join(prefix,'lib','node_modules','@afbin','cli','dist','afbin.mjs');
  const args:string[][]=[];
  const updater=automaticUpdate({...f,entry,npm:async argv=>{args.push(argv);return {code:0,stdout:'',stderr:''};},stderr:()=>{}});await updater.observe(release);await updater.finish();
  assert.deepEqual(args,[['install','-g','--prefix',prefix,'--no-fund','--no-audit','@afbin/cli@9.8.7']]);
  const windows=await automaticInstallPrefix({entry:'C:/Users/test/npm/node_modules/@afbin/cli/dist/afbin.mjs',home:'C:/Users/test',env:{},platform:'win32',timeoutMs:1000,npm:async()=>({code:0,stdout:'C:/Users/test/npm\n',stderr:''})});
  assert.equal(windows,'C:/Users/test/npm');
 }finally{await f.clean();}
});
test('npm subprocess is actually terminated on timeout',async()=>{
 const f=await fixture();
 try{
  const script=join(f.home,'npm-cli.js');await writeFile(script,'setInterval(()=>{},1000);');
  const started=Date.now();const result=await defaultNpm(['install'],{env:{...process.env,npm_execpath:script},timeoutMs:100});
  assert.notEqual(result.code,0);assert.ok(Date.now()-started<5000,'a hung npm must return promptly');
 }finally{await f.clean();}
});
