/**
 * A COMMENT WATCH NOTHING READS ANSWERS NOTHING. The real CLI process, with its stdout as each harness tool gives it:
 * a regular file (a plain background shell job, a redirect) and the null device refuse at once, naming the tool that
 * wakes the agent and the bounded fallback; a pipe (a monitor, a reader) runs and keeps running.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const MAIN=fileURLToPath(new URL('../src/main.ts',import.meta.url));
// Resolved here: the CLI runs from the temp workspace, where neither a bare `tsx` nor its path aliases would resolve.
const TSX=import.meta.resolve('tsx'),TSCONFIG=fileURLToPath(new URL('../../../tsconfig.json',import.meta.url));

async function workspace(){
 const root=await mkdtemp(join(tmpdir(),'watch-delivery-'));const home=join(root,'.home'),bin=join(root,'.bin');
 await mkdir(home,{recursive:true});await mkdir(bin,{recursive:true});
 await writeFile(join(root,'report.jsx'),'<article id="story"><h1 id="title">Report</h1><p id="para">Keep this finding.</p></article>');
 // An isolated home and no harness on PATH: eager init installs nothing outside the temp directory.
 const env={...process.env,PATH:bin,HOME:home,ARTIFACTBIN_HOME:join(home,'.artifactbin'),CLAUDE_CONFIG_DIR:join(home,'.claude'),CODEX_HOME:join(home,'.codex'),
  PI_CODING_AGENT_DIR:join(home,'.pi','agent'),XDG_CONFIG_HOME:join(home,'.config'),ARTIFACTBIN_URL:'http://127.0.0.1:9',ARTIFACTBIN_TOKEN:'',TSX_TSCONFIG_PATH:TSCONFIG};
 return {root,env,cleanup:()=>rm(root,{recursive:true,force:true})};
}

/** Runs `afbin watch report.jsx --comments --json` with the given stdout; resolves its exit and stderr. */
function watch(cwd:string,env:NodeJS.ProcessEnv,stdout:'ignore'|'pipe'|number,onStderr?:(text:string,stop:()=>void)=>void,extra:string[]=[]){
 const child=spawn(process.execPath,['--import',TSX,MAIN,'watch','report.jsx','--comments','--json',...extra],{cwd,env,stdio:['ignore',stdout,'pipe']});
 let stderr='';const timer=setTimeout(()=>child.kill('SIGKILL'),60_000);
 child.stderr!.on('data',chunk=>{stderr+=chunk;onStderr?.(stderr,()=>child.kill('SIGTERM'));});
 return new Promise<{code:number|null;signal:NodeJS.Signals|null;stderr:string}>(done=>child.on('exit',(code,signal)=>{clearTimeout(timer);done({code,signal,stderr});}));
}

test('a watch whose stdout is a file refuses at once and names the tool that wakes the agent',async()=>{
 const w=await workspace();try{
  const log=join(w.root,'watch.log'),handle=await open(log,'w');
  let result;try{result=await watch(w.root,w.env,handle.fd);}finally{await handle.close();}
  assert.equal(result.code,2,result.stderr);
  assert.match(result.stderr,/watch_output_unread/);
  assert.match(result.stderr,/stdout here is a file/);
  assert.match(result.stderr,/a tool that wakes you on each output line/);
  assert.match(result.stderr,/not as a plain background job/);
  assert.match(result.stderr,/afbin comment report\.jsx --json/);
  // After the agent's advice, the deliberate way to keep a log.
  assert.match(result.stderr,/To log events to a file on purpose, add --output <file>/);
  assert.equal(await readFile(log,'utf8'),'','nothing is written to a log nobody reads');
 }finally{await w.cleanup();}
});

test('a watch whose stdout is discarded refuses the same way',async()=>{
 const w=await workspace();try{
  const result=await watch(w.root,w.env,'ignore');
  assert.equal(result.code,2,result.stderr);
  assert.match(result.stderr,/watch_output_unread/);
  assert.match(result.stderr,/stdout here is discarded/);
 }finally{await w.cleanup();}
});

test('a watch read through a pipe, as a monitor reads it, runs until stopped',async()=>{
 const w=await workspace();try{
  let checkpoint=false;
  const result=await watch(w.root,w.env,'pipe',(text,stop)=>{if(!checkpoint&&text.includes('"checkpoint"')){checkpoint=true;stop();}});
  assert.ok(checkpoint,`the watch ran and printed its baseline checkpoint: ${result.stderr}`);
  assert.doesNotMatch(result.stderr,/watch_output_unread/);
 }finally{await w.cleanup();}
});

test('a watch told to log with --output runs even when stdout is a file, and writes its events there',async()=>{
 const w=await workspace();try{
  const log=join(w.root,'shell.log'),handle=await open(log,'w');
  let checkpoint=false,result;
  try{result=await watch(w.root,w.env,handle.fd,(text,stop)=>{if(!checkpoint&&text.includes('"checkpoint"')){checkpoint=true;stop();}},['--output','events.ndjson']);}finally{await handle.close();}
  assert.ok(checkpoint,`the watch ran and printed its baseline checkpoint: ${result.stderr}`);
  assert.doesNotMatch(result.stderr,/watch_output_unread/);
  assert.equal(await readFile(join(w.root,'events.ndjson'),'utf8'),'','the named log exists from the start');
 }finally{await w.cleanup();}
});
