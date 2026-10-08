import {State,HOME_SCOPE} from './state';
import {basename,isAbsolute} from 'node:path';
import {CliError} from './errors';
import {randomUUID} from 'node:crypto';

export interface ClaudeConversationPlan {args:string[];sessionId?:string}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validClaudeSessionId(value:unknown):value is string{return typeof value==='string'&&UUID.test(value);}
const SAFE_VALUE_FLAGS=new Map([['--model',/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/],['-m',/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/],['--fallback-model',/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/],['--permission-mode',/^(?:default|acceptEdits|plan|dontAsk|bypassPermissions)$/],['--output-format',/^(?:text|json|stream-json)$/],['--effort',/^(?:low|medium|high|max)$/],['--max-turns',/^[1-9][0-9]{0,5}$/]]);
const SAFE_BOOLEAN_FLAGS=new Set(['--chrome','--dangerously-skip-permissions','--verbose']);
function safeClaudeConversationArgs(args:readonly string[]):boolean{
 for(let i=0;i<args.length;i++){
  const arg=args[i]!;if(!arg.startsWith('-'))return false;
  const equal=arg.indexOf('=');const flag=equal<0?arg:arg.slice(0,equal);const inline=equal<0?undefined:arg.slice(equal+1);
  if(SAFE_BOOLEAN_FLAGS.has(flag)){if(inline!==undefined)return false;continue;}
  const pattern=SAFE_VALUE_FLAGS.get(flag);if(!pattern)return false;
  const value=inline??args[++i];if(typeof value!=='string'||!pattern.test(value))return false;
 }
 return true;
}
export function assertSafeClaudeConversationArgs(args:readonly string[]):void{
 if(!safeClaudeConversationArgs(args))throw new CliError('unsafe_claude_arguments','This Claude launch uses arguments that cannot be safely saved for resume.','The launch will run unchanged, but Artifactbin will not persist it as a resumable Claude conversation.');
}
export function hasClaudeSessionSelector(args:readonly string[]):boolean{
 return args.some((arg,index)=>arg==='--continue'||arg==='-c'||arg==='--fork-session'||arg==='--resume'||arg==='-r'||arg.startsWith('--resume=')||arg==='--session-id'||arg.startsWith('--session-id=' )||arg==='--fork-session'||(index>0&&args[index-1]==='--resume')||(index>0&&args[index-1]==='-r')||(index>0&&args[index-1]==='--session-id'));
}
export function planClaudeConversation(args:readonly string[],newId:string,resumeId?:string):ClaudeConversationPlan{
 if(!validClaudeSessionId(newId))throw new Error('Claude session identity must be a UUID.');
 if(resumeId!==undefined){if(!validClaudeSessionId(resumeId))throw new Error('Saved Claude session identity must be a UUID.');return {args:[...args,'--resume',resumeId],sessionId:resumeId};}
 return hasClaudeSessionSelector(args)||!safeClaudeConversationArgs(args)?{args:[...args]}:{args:[...args,'--session-id',newId],sessionId:newId};
}

export interface ClaudeConversationRecord {sessionId:string;command:string;args:string[];cwd:string;claudeConfigDir:string;claudeConfigDirExplicit?:boolean}
export interface ClaudeConversationReservation {key:string;token:string}
const RESERVATION_TTL_MS=60_000;
export const claudeConversationKey=(server:string,relayId:string)=>`${server}/${relayId}`;
export function saveClaudeConversation(state:State,server:string,relayId:string,value:ClaudeConversationRecord):void{
 if(!validClaudeSessionId(value.sessionId)||typeof value.cwd!=='string'||!isAbsolute(value.cwd)||typeof value.claudeConfigDir!=='string'||!isAbsolute(value.claudeConfigDir)||typeof value.claudeConfigDirExplicit!=='boolean'||!Array.isArray(value.args)||value.args.some(arg=>typeof arg!=='string')||typeof value.command!=='string'||basename(value.command).replace(/\.exe$/i,'')!=='claude')throw new Error('Invalid Claude conversation restart record.');
 assertSafeClaudeConversationArgs(value.args);
 state.put(HOME_SCOPE,'claude-conversation',claudeConversationKey(server,relayId),{sessionId:value.sessionId,command:value.command,args:[...value.args],cwd:value.cwd,claudeConfigDir:value.claudeConfigDir,claudeConfigDirExplicit:value.claudeConfigDirExplicit} satisfies ClaudeConversationRecord);
}
export function readClaudeConversation(state:State,server:string,relayId:string):ClaudeConversationRecord|null{
 const value=state.get<unknown>(HOME_SCOPE,'claude-conversation',claudeConversationKey(server,relayId))?.value;
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const record=value as Partial<ClaudeConversationRecord>;
 if(!validClaudeSessionId(record.sessionId)||typeof record.command!=='string'||basename(record.command).replace(/\.exe$/i,'')!=='claude'||!Array.isArray(record.args)||record.args.some(arg=>typeof arg!=='string')||typeof record.cwd!=='string'||!isAbsolute(record.cwd)||typeof record.claudeConfigDir!=='string'||!isAbsolute(record.claudeConfigDir)||(record.claudeConfigDirExplicit!==undefined&&typeof record.claudeConfigDirExplicit!=='boolean'))return null;
 try{assertSafeClaudeConversationArgs(record.args);}catch{return null;}
 return {sessionId:record.sessionId,command:record.command,args:[...record.args],cwd:record.cwd,claudeConfigDir:record.claudeConfigDir,...(record.claudeConfigDirExplicit!==undefined?{claudeConfigDirExplicit:record.claudeConfigDirExplicit}:{})};
}
export function resumeClaudeConversation(state:State,server:string,relayId:string,newId:string):{command:string;args:string[];cwd:string;conversation:ClaudeConversationRecord;reservation:ClaudeConversationReservation}{
 const saved=readClaudeConversation(state,server,relayId);
 if(!saved)throw new CliError('claude_session_not_found','No resumable Claude conversation matches that local session ID.','Only new managed Claude sessions with an Artifactbin-issued session ID can be resumed.');
 const plan=planClaudeConversation(saved.args,newId,saved.sessionId);
 const reservationKey=`${server}/${saved.sessionId}`;
 return state.transaction(()=>{
  const prefix=`${server}/`;
  for(const row of state.list<unknown>(HOME_SCOPE,'claude-conversation')){
   if(!row.key.startsWith(prefix))continue;
   if(!row.value||typeof row.value!=='object'||Array.isArray(row.value))continue;
   const value=row.value as Partial<ClaudeConversationRecord>;
   if(value.sessionId!==saved.sessionId)continue;
   const active=state.get<{exitCode?:number}>(HOME_SCOPE,'remote-agent',row.key);
   if(active&&typeof active.value.exitCode!=='number')throw new CliError('claude_session_running','That Claude conversation already has a running managed agent.','Attach with afbin remote --session <remote-session-id>, or stop it before resuming.');
  }
  const old=state.get<{token?:string;reservedAt?:number}>(HOME_SCOPE,'claude-conversation-reservation',reservationKey);
  if(old&&typeof old.value.reservedAt==='number'&&Date.now()-old.value.reservedAt<RESERVATION_TTL_MS)throw new CliError('claude_session_running','That Claude conversation is already being restarted.','Wait for the existing resume launch to finish before trying again.');
  if(old)state.delete(HOME_SCOPE,'claude-conversation-reservation',reservationKey);
  const token=randomUUID();state.put(HOME_SCOPE,'claude-conversation-reservation',reservationKey,{token,reservedAt:Date.now()},{exclusive:true});
  return {command:saved.command,args:plan.args,cwd:saved.cwd,conversation:{...saved,claudeConfigDirExplicit:saved.claudeConfigDirExplicit??true},reservation:{key:reservationKey,token}};
 });
}
export function releaseClaudeConversationReservation(state:State,reservation:ClaudeConversationReservation):void{
 state.transaction(()=>{const current=state.get<{token?:string}>(HOME_SCOPE,'claude-conversation-reservation',reservation.key);if(current?.value.token===reservation.token)state.delete(HOME_SCOPE,'claude-conversation-reservation',reservation.key);});
}
