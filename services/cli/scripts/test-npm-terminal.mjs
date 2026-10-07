/** Built npm CLI lifecycle acceptance: a native PTY must finish and release its worker process. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {removeTerminalWorkspace} from './terminal-workspace-cleanup.mjs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';

const entry=resolve(process.argv[2]??'');
assert.ok(process.argv[2],'Pass the installed npm afbin.mjs path.');
const directory=await mkdtemp(join(tmpdir(),'afbin native terminal '));
const boundedAppend=(previous,value)=>`${previous}${value}`.slice(-8192);
const diagnosticText=value=>String(value??'').replaceAll('test-terminal-only','[redacted]').slice(-2000);
let worker,output='',outputTail='',exitReceipt,registration,startupReceipt,workerSpawned=false,workerDisconnected=false,workerMessages=0,exchangeCount=0,nativeReady=false;
const server=createServer(async(req,res)=>{
 try{
  assert.equal(req.headers.authorization,'Bearer test-terminal-only');
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw||'{}');res.setHeader('Content-Type','application/json');
  if(req.url==='/api/remote/sessions'){
   registration=body;res.end(JSON.stringify({id:'npm-terminal',runnerKey:'test-runner-proof'}));return;
  }
  assert.equal(req.url,'/api/remote/sessions/npm-terminal/exchange');
  exchangeCount++;const chunk=body.output??'';output=boundedAppend(output,chunk);nativeReady ||= output.includes('NATIVE_READY')||(outputTail+chunk).includes('NATIVE_READY');outputTail=(outputTail+chunk).slice(-'NATIVE_READY'.length+1);if(body.exitCode!==undefined)exitReceipt=body.exitCode;
  const inputs=nativeReady&&!body.ack?[{id:1,kind:'input',data:'finish\r'}]:[];
  res.end(JSON.stringify({controller:'local',inputs}));
 }catch(error){res.statusCode=500;res.end(JSON.stringify({error:'test_failure',message:error.message}));}
});
await new Promise((yes,no)=>{server.once('error',no);server.listen(5020,'127.0.0.1',yes);});
try{
 const terminalProgram=join(directory,'terminal-program.mjs');
 await writeFile(terminalProgram,`import {createInterface} from 'node:readline';
const lines=createInterface({input:process.stdin});
console.log('NATIVE_READY');
lines.once('line',line=>{
 if(line!=='finish'){process.exitCode=2;lines.close();process.stdin.pause();return;}
 console.log('FINAL_NATIVE_OUTPUT');lines.close();process.stdin.pause();
 setTimeout(()=>{process.exitCode=7;},100);
});\n`);
 worker=spawn(process.execPath,[...process.execArgv,entry,'--internal-remote-worker'],{
  cwd:directory,env:{...process.env,HOME:directory,USERPROFILE:directory,ARTIFACTBIN_SKILLS:'off',ARTIFACTBIN_HOME:join(directory,'private-state'),CLI__AUTO_UPDATE:'off'},
  stdio:['ignore','pipe','pipe','ipc'],
 });
 let stdout='',stderr='';worker.stdout.on('data',data=>{stdout=boundedAppend(stdout,data);});worker.stderr.on('data',data=>{stderr=boundedAppend(stderr,data);});
 worker.once('spawn',()=>{workerSpawned=true;});worker.once('disconnect',()=>{workerDisconnected=true;});
 worker.on('message',message=>{workerMessages++;if(message.error)stderr=boundedAppend(stderr,message.error);else startupReceipt=message;});
 const completion=new Promise((yes,no)=>{
  const deadline=setTimeout(()=>{
   const diagnostic={stdout:diagnosticText(stdout),stderr:diagnosticText(stderr),relayOutput:diagnosticText(output),exitReceipt,
    registrationReceived:Boolean(registration),registrationManaged:registration?.managed??null,registrationName:registration?.name??null,
    startupReceipt:startupReceipt?{status:startupReceipt.status,pid:startupReceipt.pid}:null,exchangeCount,
    workerSpawned,workerDisconnected,workerMessages,workerExitCode:worker.exitCode,workerSignalCode:worker.signalCode};
   worker.kill();no(new Error(`Native CLI worker did not exit naturally after 20s: ${JSON.stringify(diagnostic)}`));
  },20000);
  worker.once('error',error=>{clearTimeout(deadline);no(error);});
  worker.once('exit',(code,signal)=>{clearTimeout(deadline);yes({code,signal});});
 });
 worker.send({connection:{server:'http://127.0.0.1:5020',token:'test-terminal-only'},command:process.execPath,args:[terminalProgram],name:'terminal-proof',cwd:directory,home:directory});
 const result=await completion;
 assert.equal(result.signal,null,stderr);assert.equal(result.code,7,stderr);
 assert.equal(startupReceipt?.status,'starting');assert.equal(registration?.managed,true);
 assert.match(output,/FINAL_NATIVE_OUTPUT/);assert.equal(exitReceipt,7,'final exit must reach the relay before worker shutdown');
 const {DatabaseSync}=await import('node:sqlite');
 const db=new DatabaseSync(join(directory,'private-state','state.sqlite'),{readOnly:true});
 try{
  const rows=db.prepare("SELECT value FROM records WHERE kind='remote-agent'").all();
  assert.ok(rows.some(row=>JSON.parse(row.value).exitCode===7),'local exit receipt must survive worker shutdown');
 }finally{db.close();}
 console.log(JSON.stringify({native_terminal:'passed',natural_exit:true,exit_receipt:exitReceipt,platform:process.platform,node:process.version}));
}finally{
 if(worker?.exitCode===null&&!worker?.signalCode)worker.kill();
 server.closeAllConnections();await new Promise(yes=>server.close(yes));await removeTerminalWorkspace(directory);
}
