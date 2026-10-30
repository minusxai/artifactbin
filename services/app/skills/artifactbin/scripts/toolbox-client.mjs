import {beforeCommand} from './toolbox-update.mjs';
/**
 * Internal: shared runtime of the installed commands: ToolError, argument and file helpers, the
 * origin-bound HTTP client (makeClient) and runTool, which parses flags, runs a command and prints
 * its JSON envelope. Journals live in toolbox-journal.mjs, the check digest in
 * toolbox-check-digest.mjs; both are re-exported here.
 * Used by: every command script (auth serve autofix publish read export check graphql comment),
 *   toolbox-*.mjs, author-toolbox/author-check tests.
 */
import {homedir} from 'node:os';
import path from 'node:path';
import {readFile,writeFile,realpath,lstat} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import configuredServer from './toolbox-config.mjs';
import {parseCommand} from './toolbox-commands.mjs';
import {commandHelp} from './toolbox-description.mjs';
import {checkDigest} from './toolbox-check-digest.mjs';
export {checkDigest};
// toolbox-journal.mjs imports helpers back from this module; the cycle is safe because neither
// module uses the other's exports while loading.
export {createJournal,journalIntent,resumeJournal} from './toolbox-journal.mjs';
export class ToolError extends Error{constructor(code,message,exit=1,recovery=
  'Inspect the refusal and correct the request.',details){super(message);Object.assign(this,{code,
  exit,recovery,details});}}
export function serverOrigin(value){let url;try{url=new URL(value);}catch{throw new ToolError(
  'server_required','Select --server ORIGIN or origin-bound ARTIFACTBIN_URL.',2);}
if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||
   url.search||url.hash)throw new ToolError('invalid_origin',
   'Select an HTTP(S) origin without path or credentials.',2);return url.origin;}
export function resolveTarget(value,selected){
 let id=value,server=selected;
if(/^https?:/i.test(value??'')){const url=new URL(value);if(url.username||url.password||url.search||
   url.hash||!/^\/a\/[A-Za-z0-9]{6,12}\/?$/.test(url.pathname))throw new ToolError('invalid_target',
   'Use an ID or canonical hosted /a/ID URL.',2);if(server&&serverOrigin(
   server)!==url.origin)throw new ToolError('origin_mismatch','Target and selected server differ.',
   2);server=url.origin;id=url.pathname.split('/')[2];}
if(!/^[A-Za-z0-9]{6,12}$/.test(id??''))throw new ToolError('invalid_target',
   'Use an artifact ID or canonical hosted URL.',2);
 return {server:serverOrigin(server),id};
}
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const platform=()=>import('./toolbox-platform.mjs');
export const credentialRoot=(env=process.env)=>path.resolve(env.ARTIFACTBIN_HOME||path.join(homedir(
  ),'.artifactbin'));
export const selectedServer=(values={},env=process.env)=>values.server??env.ARTIFACTBIN_URL??
  configuredServer;
export async function jsonFile(file){try{return JSON.parse(await readFile(file,'utf8'));}catch{
  throw new ToolError('invalid_json_file','Cannot read the selected JSON input.',2,
  'Provide a readable JSON file.');}}
export function integer(value,name,min=1,max=Number.MAX_SAFE_INTEGER){if(!/^\d+$/.test(String(
  value))||!Number.isSafeInteger(Number(value))||Number(value)<min||Number(
  value)>max)throw new ToolError('invalid_'+name,
  `${name} must be an integer from ${min} to ${max}.`,2);return Number(value);}
export function requireFlags(values,names){for(const name of names)if(values[
  name]===undefined)throw new ToolError('missing_'+name,`--${name} is required.`,2,'Read --help.');}
export function enumValue(value,allowed,name){if(!allowed.includes(value))throw new ToolError(
  'invalid_'+name,`${name}: choose ${allowed.join('|')}.`,2);return value;}
export function positional(args,count=1){if(args.length!==count)throw new ToolError(
  'invalid_arguments',`Expected ${count} positional argument(s).`,2,'Read --help.');return args[0];}
export async function optionalFile(file){try{return await readFile(file);}catch(error){if(
  error.code==='ENOENT')return null;throw error;}}
export async function exclusive(file,bytes){await writeFile(file,bytes,{flag:'wx',mode:0o600});}
export async function safeParent(file){const parent=await realpath(path.dirname(path.resolve(
  file)));return path.join(parent,path.basename(file));}
export function within(root,file){const relative=path.relative(root,file);return relative===''||
  relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);}
export function makeClient(server,{env=process.env,fetcher=fetch,retryDelays=undefined}={}){
 server=serverOrigin(server);const root=credentialRoot(env);
 async function grant(){
if(env.ARTIFACTBIN_TOKEN){if(env.ARTIFACTBIN_URL!==server)throw new ToolError(
    'credential_origin_mismatch','Environment grant belongs to another origin.',3);return {server,
    token:env.ARTIFACTBIN_TOKEN};}
  const shared=await platform();let saved=await shared.readCredentials(server,root);
if(!saved)throw new ToolError('auth_required','No saved grant for this origin.',3,
    'Run auth.mjs login --email ADDRESS.');
if(saved.expiresAt&&saved.expiresAt<Date.now()+30000){try{saved=await shared.refreshCredentials(
    saved,root,{fetch:fetcher});}catch(error){throw new ToolError(error.code??'auth_required',
    'Saved grant could not be refreshed; credentials retained.',
    error.code==='refresh_unavailable'?1:3,'Retry later or complete sign-in.');}}
  return saved;
 }
 /** @param {string} route @param {any} options */
async function request(route,{method='GET',body,headers={},unsafe=false,safeToRepeat=false,raw=
   false,timeoutMs=30000,authenticated=true,signal}={}){
const url=new URL(route,server);if(url.origin!==server||!route.startsWith('/')||route.startsWith(
    '//')||route.includes('\\'))throw new ToolError('origin_mismatch',
    'Refused a request outside the selected origin.',2);
  let connection=authenticated?await grant():null;
  for(let attempt=0;attempt<2;attempt++){
   let response;
   // Transient outage (a deploy restart): the shared policy (lib/http/retry) retries network errors
   // and 502/503/504 — reads, declared-safe requests and keyed writes only, the same
   // Idempotency-Key every time; never 4xx.
try{response=(await (await platform()).retryFetch(()=>fetcher(url,{method,redirect:'error',signal:
     signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs),
     headers:{'X-Artifactbin-Protocol':'native-author-v1',Origin:server,...(connection?{
     Authorization:'Bearer '+connection.token}:{}),...(body===undefined?{}:{'Content-Type':
     'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),{
     method,idempotencyKey:headers['Idempotency-Key'],safeToRepeat,signal,policy:retryDelays?{
     delaysMs:retryDelays}:undefined})).response;}
catch{throw new ToolError(unsafe?'outcome_unknown':'network_unavailable',
     unsafe?'Write outcome is unknown.':'Server request failed.',unsafe?5:1,
     unsafe?'Resume only the saved supported journal; reconcile arbitrary mutations before '+
     'another write.':'Retry this read later.');}
if(response.status===401&&attempt===0&&connection?.refreshToken){const shared=await platform();
     connection=await shared.refreshCredentials(connection,root,{fetch:fetcher});continue;}
if(response.ok){if(raw)return response;try{return await response.json();}catch{throw new ToolError(
     unsafe?'outcome_unknown':'invalid_response',
     unsafe?'Write response could not be read; outcome is unknown.':
     'Server response was not valid JSON.',unsafe?5:1,
     unsafe?'Resume only the saved supported journal; reconcile arbitrary mutations before '+
     'another write.':'Retry this read later.');}}
   const refusal=await response.json().catch(()=>({error:'http_'+response.status}));
const code=typeof refusal.error==='string'?refusal.error:refusal.error?.code??
     'http_'+response.status;
throw new ToolError(code,`Request refused (HTTP ${response.status}).`,[401,403,404].includes(
     response.status)?3:response.status===409?4:unsafe&&response.status>=500?5:1,refusal.hint??(
     response.status===409?'A newer version exists. Run read.mjs ID --output fresh.html, reapply '+
     'your edits there and publish it; do not resume this journal.':
     unsafe?'Retain the journal; retry the exact supported intent after recovery.':
     'Inspect access and request inputs.'),refusal);
  }
 }
 return {server,root,request,grant,fetcher};
}
/** Unexpected errors keep a generic message (raw text can carry URLs or paths); a network/server
 * blip says so and suggests one retry. */
const transient=error=>!(error instanceof ToolError)&&
  /fetch failed|ECONN|ETIMEDOUT|EAI_AGAIN|socket|network|timed? ?out|\b5\d\d\b/i.test(String(
  error?.message)+' '+String(error?.cause?.code??''));
/** A lapsed sign-in, whichever layer noticed it (a refused refresh throws a plain Error whose text
 * starts `auth_required`). A missing grant keeps its own message: nothing lapsed. */
const authLapse=error=>(error?.code==='auth_required'||/^auth_required\b/.test(String(
  error?.message)))&&!(error instanceof ToolError&&/^No saved grant/.test(error.message));
/** The process exit code for a failure: 3 (auth/access) for a lapsed sign-in. */
export const toolExit=error=>error?.exit??(authLapse(error)?3:1);
/** Preserve legacy details while exposing a stable check result on all refusals. */
export function toolFailure(name,error){
if(authLapse(error))return {ok:false,code:'auth_required',message:
  'Sign-in expired: run node scripts/auth.mjs login --email ADDRESS',recovery:
  'Ask the user for their email, run the command, then ask for the emailed code. Never search '
  +'for credentials.'};
// A broken install names the missing module (a path, not a secret), not a generic failure.
if(error?.code==='ERR_MODULE_NOT_FOUND'){
  const missing=/Cannot find (?:module|package) '([^']+)'/.exec(String(error.message))?.[1];
  return {ok:false,code:error.code,message:missing?`Missing module ${missing}: the skill `
    +'install is incomplete.':String(error.message).split('\n')[0].slice(0,300),
    recovery:'Download the skill zip again and extract its whole artifactbin/ folder; '
    +'run scripts from inside it.'};
}
const diagnostics=name==='check'?{smokePassed:false,checks:[],unverified:['visual appearance',
   'task behavior','persistence','permissions'],note:'No passing smoke evidence.',...(
   error.code==='check_failed'?error.details:{})}:{};
return {...diagnostics,ok:false,code:error.code??'operation_failed',message:
   error instanceof ToolError?error.message:transient(
   error)?'Network or server error before a result arrived.':
   'Operation failed; inspect the selected files and server.',recovery:error.recovery??(transient(
   error)?'Retry once; written requests resume from their journal.':
   'Correct the input or inspect the underlying operation.'),...(error.details?{details:
   error.details}:{})};
}
/** @param {(parsed:any)=>Promise<import(
  '../../../lib/skills/author-toolbox-contract').AuthorResult|any>} execute */
export async function runTool(name,url,execute,args=process.argv.slice(2)){
 if(!process.argv[1]||realpathSync(process.argv[1])!==fileURLToPath(url))return;
 if(await beforeCommand(url,args))return;
 args=args.filter(arg=>arg!=='--no-update');
 let parsed;
 try{
try{parsed=parseCommand(name,args);}catch(error){throw new ToolError('invalid_invocation',
    error.message,2,'Read --help.');}
  if(parsed.values.help){process.stdout.write(commandHelp(name));return;}
if(parsed.values.output&&!parsed.values.append){const destination=await safeParent(
    parsed.values.output);let exists=false;try{await lstat(destination);exists=true;}catch(error){
    if(error.code!=='ENOENT')throw error;}if(exists)throw new ToolError('output_exists',
    'Output already exists.',2,'Choose a new output path; existing files are retained.');}
  const result=await execute(parsed);
  if(result===undefined)return;
  const envelope={ok:true,code:'completed',...result};
  const data=JSON.stringify(envelope,null,parsed.values.json?0:2)+'\n';
if(parsed.values.output&&!result.outputOwned){await exclusive(parsed.values.output,data);if(
    name==='check')process.stdout.write(checkDigest(envelope,parsed.values.output));
    }else process.stdout.write(data);
  // A publish that added data-af-ids says so last, below the JSON, where a tail of the output
  // still shows it.
  for(const note of [result.rewritten])if(typeof note==='string'&&
   !parsed.values.json)process.stderr.write(note+'\n');
 }catch(error){
  const envelope=toolFailure(name,error);
if(name==='check'&&parsed?.values.output){try{await exclusive(parsed.values.output,JSON.stringify(
    envelope,null,2)+'\n');process.stdout.write(checkDigest(envelope,parsed.values.output));}catch{
    process.stderr.write('Could not save check output; existing files were retained.\n');}}
if(parsed?.values.json)process.stdout.write(JSON.stringify(envelope)+'\n');
    else process.stderr.write(envelope.code+': '+envelope.message+' '+envelope.recovery+'\n');
    process.exitCode=toolExit(error);
 }
}
