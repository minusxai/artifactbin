/**
 * Internal: who this agent session is. Every request carries its display name (Artifactbin-Agent,
 * e.g. "Claude Code Red") and an opaque session key (Artifactbin-Session), so comments show the
 * name and the comment feed marks only this session's own writes `you`, even when another agent
 * on the computer shares the sign-in. The session is the harness's own session ID (Claude Code,
 * Codex, OpenCode); else the nearest ancestor process that is not a shell or wrapper, with its
 * start time (Pi, unknown agents), read from /proc or ps. Where neither can be read (ps refused
 * in a sandbox) the session is unidentified (never the shell's pid: it changes with every
 * command): named with --as or ARTIFACTBIN_AGENT_NAME, that name is its key, so two agents with
 * different names see each other's comments; unnamed, no key is sent and the feed keeps the
 * credential rule. An unidentified session's name is never saved: another session would take it.
 * The name is --as NAME (kept for the session), else ARTIFACTBIN_AGENT_NAME, else the kept one,
 * else derived: the harness name plus a colour picked from the session (an unknown
 * harness: a colour and an animal), skipping colours other sessions in this sign-in folder use.
 * Names live in <sign-in folder>/agents/<session>.json.
 * Used by: toolbox-client.mjs (request headers), toolbox-watch-state.mjs (per-session watch log),
 *   comment.mjs (--as, the name note), agent-identity-toolbox and agent-sessions-toolbox tests.
 */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,readdirSync,renameSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {ToolError} from './toolbox-transport.mjs';
export const COLOURS=['Red','Orange','Amber','Yellow','Lime','Green','Emerald','Teal','Cyan',
  'Sky','Blue','Indigo','Violet','Purple','Magenta','Pink','Rose','Crimson','Coral','Gold',
  'Olive','Navy','Silver','Bronze'];
const ANIMALS=['Fox','Owl','Otter','Lynx','Heron','Badger','Falcon','Hare','Wolf','Raven','Seal',
  'Crane','Bison','Marten','Panda','Koala','Gecko','Ibex','Puffin','Tapir','Yak','Lemur','Orca',
  'Wren'];
/** Harness, display product and where its session ID lives; checked in order. */
const HARNESSES=[
 {harness:'claude-code',label:'Claude Code',key:env=>env.CLAUDE_CODE_SESSION_ID,
  on:env=>env.CLAUDECODE==='1'||!!env.CLAUDE_CODE_SESSION_ID},
 {harness:'codex',label:'Codex',on:env=>!!env.CODEX_THREAD_ID,key:env=>env.CODEX_THREAD_ID},
 {harness:'opencode',label:'OpenCode',on:env=>!!env.OPENCODE,key:env=>env.OPENCODE_PID},
 {harness:'pi',label:'Pi',on:env=>env.PI_CODING_AGENT==='true',key:()=>undefined},
];
/** Processes between the agent and this script: shells, wrappers and sandboxes, never the agent. */
const WRAPPERS=new Set(['sh','bash','zsh','dash','fish','ksh','mksh','tcsh','csh','env','timeout',
  'gtimeout','nohup','sandbox-exec','sudo','script','stdbuf','nice','ionice','time','xargs',
  'bwrap','firejail','setsid','caffeinate','login']);
/** One process: its parent pid, start time and command, from /proc on Linux, else ps. */
export function psProcess(pid){
 if(process.platform==='linux'){const stat=readFileSync(`/proc/${pid}/stat`,'utf8'),end=stat
  .lastIndexOf(')'),fields=stat.slice(end+2).split(' ');return {ppid:Number(fields[1]),
  started:fields[19],command:stat.slice(stat.indexOf('(')+1,end)};}
 const line=execFileSync('ps',['-o','ppid=,lstart=,comm=','-p',String(pid)],{encoding:'utf8',
  stdio:['ignore','pipe','ignore'],timeout:2000}).trim();
 const match=/^(\d+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d+)\s+(.+)$/.exec(line);
 return match?{ppid:Number(match[1]),started:match[2],command:match[3]}:null;
}
/** The nearest ancestor that is not a wrapper: its pid and start time are this session's key;
 * null when the process table cannot be read that far. */
export function ancestorKey(start=process.ppid,ps=psProcess){
 let pid=start;
 for(let depth=0;depth<16&&pid>1;depth++){
  let info;try{info=ps(pid);}catch{info=null;}if(!info)break;
  const name=path.basename(info.command.trim().split(/\s+/)[0]).replace(/^-/,'');
  if(!WRAPPERS.has(name))return `${pid}@${info.started}`;
  pid=info.ppid;
 }
 return null;
}
/** The harness this script runs under and its session key (never sent raw: see sessionId). */
export function detectSession(env=process.env,{ps=psProcess,ppid=process.ppid}={}){
 const found=HARNESSES.find(h=>h.on(env));
 const key=found?.key(env)||ancestorKey(ppid,ps);
 return {harness:found?.harness??null,label:found?.label??null,key};
}
const seed=session=>createHash('sha256').update(
  `artifactbin-session\0${session.harness??''}\0${session.key??''}`).digest('hex');
/** The opaque key sent as Artifactbin-Session: a hash, so the harness's session ID never leaves;
 * null for an unidentified session. */
export const sessionId=session=>session.key?seed(session).slice(0,32):null;
/** A name an agent may give itself: printable ASCII (it travels in a header), 1-64 characters. */
export function agentName(value,source='--as'){
 const name=String(value??'').replace(/\s+/g,' ').trim();
 if(!/^[\x20-\x7E]{1,64}$/.test(name))throw new ToolError('invalid_agent_name',
  `${source}: use 1-64 printable ASCII characters, such as "Claude Code Red".`,2);
 return name;
}
const named=(root,id)=>path.join(root,'agents',`${id}.json`);
function savedNames(root){
 const names=new Map();let files=[];try{files=readdirSync(path.join(root,'agents'));}catch{}
 for(const file of files)if(file.endsWith('.json'))try{const saved=JSON.parse(readFileSync(
  path.join(root,'agents',file),'utf8'));if(typeof saved?.name==='string')names.set(
  file.slice(0,-5),saved.name);}catch{}
 return names;
}
/** Saved beside the sign-in only: a folder that does not exist yet is never created for it. */
function keep(root,id,name){
 if(!root||!existsSync(root))return;
 try{mkdirSync(path.join(root,'agents'),{mode:0o700,recursive:true});const file=named(root,id),
  temp=`${file}.${process.pid}.tmp`;writeFileSync(temp,JSON.stringify({name,at:Date.now()})+'\n',
  {mode:0o600});renameSync(temp,file);}catch{}
}
/** The derived name: the product and a colour from the session, past colours others hold. */
export function derivedName(session,taken=new Set()){
 const n=parseInt(seed(session).slice(0,8),16);
 for(let step=0;step<COLOURS.length;step++){
  const colour=COLOURS[(n+step)%COLOURS.length],name=session.label?`${session.label} ${colour}`:
   `${colour} ${ANIMALS[Math.floor(n/COLOURS.length)%ANIMALS.length]}`;
  if(!taken.has(name))return name;
 }
 return session.label?`${session.label} ${COLOURS[n%COLOURS.length]}`:`${COLOURS[n%COLOURS
  .length]} ${ANIMALS[0]} ${seed(session).slice(0,4)}`;
}
/** This session's identity: {name, session, source, harness}; source is as|env|saved|derived. A
 * comment write saves --as and a derived name (save); every other request only reads them. */
export function agentIdentity({env=process.env,root,as,ps,ppid,save=false}={}){
 const session=detectSession(env,{ps,ppid}),id=sessionId(session),others=savedNames(root);
 const mine=id?others.get(id):undefined;if(id)others.delete(id);
 let name,source;
 if(as!==undefined){name=agentName(as);source='as';if(id&&save&&name!==mine)keep(root,id,name);}
 else if(env.ARTIFACTBIN_AGENT_NAME){name=agentName(env.ARTIFACTBIN_AGENT_NAME,
  'ARTIFACTBIN_AGENT_NAME');source='env';}
 else if(mine){name=mine;source='saved';}
 else{name=derivedName(session,new Set(others.values()));source='derived';
  if(id&&save)keep(root,id,name);}
 // Unidentified but named: the name tells this agent apart from the others on this computer.
 const nameKey=!id&&(source==='as'||source==='env')?createHash('sha256').update(
  `artifactbin-named-session\0${session.harness??''}\0${name}`).digest('hex').slice(0,32):null;
 return {name,session:id??nameKey,source,harness:session.harness,product:session.label,
  unidentified:!id};
}
/** The request headers that carry the identity (both self-reported: attribution, never access). */
export const agentHeaders=identity=>({'Artifactbin-Agent':identity.name,
  ...(identity.session?{'Artifactbin-Session':identity.session}:{})});
/** What a write prints about the name it carried, and how to choose another. */
export function nameNote(identity){
 if(identity.unidentified){
  // Unnamed: suggest a random colour, so two agents given this note pick different names.
  const product=identity.product??'<your product>',suggest=identity.source===
   'as'||identity.source==='env'?identity.name:`${product} ${COLOURS[Math.floor(Math.random()*
   COLOURS.length)]}`;
  return `Comments show you as "${identity.name}". This agent session cannot be told apart from `+
   `other agents on this computer, so pass the same --as "${suggest}" on every comment.mjs `+
   'command, watch included; otherwise your comments and theirs look like one agent\'s.';
 }
 const how=identity.harness?'pass --as "NAME" (kept for this session)':
  'name yourself: pass --as "<your product> <Colour>", such as --as "Cursor Red"';
 return `Comments show you as "${identity.name}". To use another name, ${how}.`;
}
