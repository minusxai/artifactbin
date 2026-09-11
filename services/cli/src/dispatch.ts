import {accountPlan,listAccountCollection,localAccountCommand,remoteAccountCommand} from './account-workspace';
import {remoteQuery} from './remote-query';
import {batchCommand} from './batch';
import {resultOutput} from './result-output';
import {queryMutation} from './mutation-command';
import {localQuery,queryParameters} from './local-query';
import {updateCli} from './update';
import {prepareMarkdown,commitMarkdown,type MarkdownPlan} from './markdown';
import {installSkills,selectSkills,type SkillChoice,type SkillHarness} from './skill-install';
import {CLI_VERSION} from './version';
import {CLI_PROTOCOL_VERSION} from '../../contracts/src/cli-auth';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {readOptional} from './files';
import {recoverFiles} from './journal';
import {withProcessLock} from './process-lock';
import {homedir} from 'node:os';
import {parseCommand,commandHelp,commands,CliError,type ParsedCommand} from './commands';
import {loadWorkspace} from './workspace';
import {validateFiles} from './validation';
import {deleteArtifact} from './delete';
import {compare,remoteStatus} from './comparison';
import {localStatus,localDiff} from './local';
import {helpTopics} from './teaching';
import {loadConnection} from './config';
import {browserAuthenticate,ApprovalRequired,type AuthOptions} from './browser-auth';
import {HttpClient} from './http';
import {resolveReference} from './reference';
import {preparePull,pull} from './pull';
import {finishSavedRequest,finishLocalPush,planPush,push} from './sync';
import {artifactReference,readCommand,commentCommand} from './read-commands';
import {readPendingRequest} from './pending-request';
export interface CliContext {auth?:Pick<AuthOptions,'open'|'now'|'sleep'>;env?:NodeJS.ProcessEnv;chooseSkills?:(choices:SkillChoice[])=>Promise<SkillHarness[]>;cwd?:string;home?:string;interactive?:boolean;stdout?:(value:string)=>void;stdoutBytes?:(value:Uint8Array)=>void;stderr?:(value:string)=>void;fetch?:typeof fetch}
export async function runCli(argv:string[],context:CliContext={}):Promise<number>{
 const stdout=context.stdout??(value=>process.stdout.write(value));const stderr=context.stderr??(value=>process.stderr.write(value));
 let parsed:ParsedCommand|undefined;let json=argv.includes('--json');
 try{
  parsed=parseCommand(argv);json=!!parsed.flags.json;
  const {command,positionals,flags}=parsed;
  let recoveredRequest:string|undefined;let markdownPlan:MarkdownPlan|undefined;let querySql:string|undefined;
  const emit=(value:unknown)=>{if(markdownPlan?.conversions.length&&value&&typeof value==='object')value={...value,conversions:markdownPlan.conversions.map(x=>({source:x.source,path:x.target}))};if(recoveredRequest&&value&&typeof value==='object')value={...value,recovered_request:recoveredRequest};stdout(json?JSON.stringify(value)+'\n':typeof value==='string'?value.endsWith('\n')?value:value+'\n':JSON.stringify(value,null,2)+'\n');};
  if(flags.version){emit(json?{version:CLI_VERSION,protocol:CLI_PROTOCOL_VERSION}:`afbin ${CLI_VERSION}`);return 0;}
  if(flags.help||command==='help'){
   const topic=command==='help'?positionals[0]:command;
   const text=!topic||commands.some(c=>c.name===topic||c.aliases?.includes(topic))?commandHelp(topic):helpTopics[topic];
   if(text===undefined)throw new CliError('unknown_help_topic',`Unknown help topic ${topic}.`,'Run afbin help.');
   emit(json?{help:text}:text);return 0;
  }
  pendingIntegration(parsed);
  let workspace=await loadWorkspace(context.cwd);
  const account=await accountPlan(workspace,parsed);
  if(account){const local=await localAccountCommand(workspace,parsed,account);if(local!==undefined){emit(local);return (local as {valid?:boolean}).valid===false?2:0;}}
  const serverOrigin=()=>typeof flags.server==='string'?flags.server:workspace.lock?.server??account?.manifest?.server??(context.env??process.env).ARTIFACTBIN_URL;
  if(['push','pull','delete'].includes(command)&&(!account||command==='pull')&&!flags['dry-run']&&await readOptional(join(workspace.root,'.artifactbin','pending-operation.json')))throw new CliError('pending_recovery','Recover the pending operation before changing this workspace.','Repeat the original command and inputs.');
  const pendingFiles=await readOptional(join(workspace.root,'.artifactbin','pending-files.json'));
  if(pendingFiles&&['push','pull','delete'].includes(command)&&!flags['dry-run']){
   await withProcessLock(workspace.root,()=>recoverFiles(workspace.root));workspace=await loadWorkspace(context.cwd);
  }
  if(pendingFiles&&command==='validate'&&flags.fix)throw new CliError('pending_recovery','Finish the interrupted file commit before applying fixes.','Run afbin push or afbin pull to recover it.');
  if(!account&&(command==='push'||command==='validate')){
   markdownPlan=await prepareMarkdown(workspace,positionals);
   if(markdownPlan.conversions.length){
    if(command==='validate'&&flags.fix)throw new CliError('unsupported_flag','Markdown conversion is a one-time push operation; validate --fix edits JSX only.','Run afbin validate file.md to preview validation, or afbin push file.md to convert it.');
    workspace=markdownPlan.workspace;positionals.splice(0,positionals.length,...markdownPlan.paths);
   }
  }
  if(command==='validate'&&!account){const result=await validateFiles(workspace,positionals,!!flags.fix);emit(result);return result.valid?0:2;}
  if(command==='status'&&!account&&!flags.remote){emit(await localStatus(workspace));return 0;}
  if(command==='diff'&&!account&&!flags.remote){
   try{emit(positionals.length?await compare(workspace,positionals[0],serverOrigin()??'https://artifactbin.dev',false):await localDiff(workspace));return 0;}
   catch(error){if(!(error instanceof CliError)||error.code!=='network_required')throw error;}
  }
  const selectedServer=serverOrigin()??'https://artifactbin.dev';
  if(command==='query'){
   queryParameters(flags.param as string[]|undefined);
   querySql=typeof flags.input==='string'?(flags.input==='-'?await readStdin():await readFile(resolve(workspace.cwd,flags.input),'utf8')):undefined;
   const result=await localQuery(workspace,parsed,querySql,selectedServer);if(result){await resultOutput(result,parsed,workspace.cwd,emit,stdout);return 0;}
  }
  if(['comment','log'].includes(command)||command==='delete'&&flags.type!=='session')for(const ref of positionals)await artifactReference(workspace,ref,selectedServer,command!=='log');
  if(command==='push'&&!account)for(const path of positionals)if(/@\d+$/.test(path))await resolveReference(path,{root:workspace.root,cwd:workspace.cwd,server:selectedServer,writable:true});
  if(command==='push'&&!account&&flags['dry-run']){const plans=await planPush(workspace,positionals,{force:!!flags.force,dryRun:true});if(plans.every(plan=>plan.mode==='missing')){emit({dry_run:true,operations:plans.map(plan=>({path:plan.file.path,status:'skipped',reason:'missing_file'}))});return 0;}}
  if(command==='push'&&!account&&!flags['dry-run']){recoveredRequest=await finishSavedRequest(workspace,serverOrigin());if(recoveredRequest)workspace=await loadWorkspace(workspace.cwd);}
  if(command==='push'&&!account&&!flags['dry-run']&&!await readPendingRequest(workspace.root)){
   const result=await finishLocalPush(workspace,positionals,!!flags.force);if(result){emit(result);return 0;}
  }
  if(command==='pull'&&!account){const targets=await preparePull(workspace,positionals,!!flags.force,serverOrigin(),flags.output as string|undefined);if(!targets.length){emit({operations:[]});return 0;}}
  let commentBody=typeof flags.body==='string'?flags.body:undefined;
  if(command==='comment'&&typeof flags.input==='string')commentBody=flags.input==='-'?await readStdin():await readFile(resolve(workspace.cwd,flags.input),'utf8');
  if(commentBody!==undefined&&(!commentBody.trim()||commentBody.length>100000))throw new CliError('invalid_comment','Comment text must contain 1–100000 characters.');
  const server=serverOrigin();
  const home=context.home??homedir();const interactive=context.interactive??!!process.stdin.isTTY;
  if(command==='update'){
   const selected=await selectSkills({home,env:context.env,interactive,yes:!!flags.yes,requested:flags.harness as string[]|undefined,choose:context.chooseSkills});
   emit(await updateCli({home,server:server??'https://artifactbin.dev',env:context.env,harnesses:selected,fetch:context.fetch}));return 0;
  }
  let connection=await loadConnection(server,home,context.env);
  const firstAuthentication=!connection;
  const authenticate=()=>browserAuthenticate(connection?.server??server??'https://artifactbin.dev',{...context.auth,home,interactive,noBrowser:!!flags['no-browser'],rejectedToken:connection?.token,fetch:context.fetch,notify:message=>stderr(message+'\n')});
  if(command==='setup'&&flags['dry-run']){
   const harnesses=await selectSkills({home,env:context.env,interactive:false,requested:flags.harness as string[]|undefined});
   emit({dry_run:true,server:connection?.server??server??'https://artifactbin.dev',credentials:connection?'saved_not_verified':'missing',harnesses});return 0;
  }
  if(command==='setup'&&connection){
   const probe=new HttpClient({connection,home,fetch:context.fetch});
   try{await probe.request('/artifacts?limit=1');connection=probe.connection;}catch(error){if(!(error instanceof CliError)||error.code!=='auth_required')throw error;connection=await authenticate();}
  }
  if(!connection){
   if(flags['dry-run'])throw new CliError('auth_required','Sign-in is required for this operation.','Run afbin setup, or set ARTIFACTBIN_TOKEN for the selected server.');
   connection=await authenticate();
  }
  if(command==='setup'||firstAuthentication){
   const selected=await selectSkills({home,env:context.env,interactive,yes:!!flags.yes,requested:flags.harness as string[]|undefined,choose:context.chooseSkills});
   const installed=await installSkills(selected,{home,env:context.env});
   if(command==='setup'){emit({authenticated:true,server:connection.server,...installed});return 0;}
   for(const item of installed.installations)stderr(`Skill ${item.status}: ${item.path}${item.backup?` (backup: ${item.backup})`:''}\n`);
  }
  const client=new HttpClient({connection,home,fetch:context.fetch,account:workspace.lock?.account,readOnly:!!flags['dry-run'],...(!flags['dry-run']?{authenticate}: {})});
  if(account){const result=await remoteAccountCommand(workspace,parsed,account,client);if(result.content!==undefined)stdout(result.content);else emit(result.value);return result.exitCode??0;}
  if(command==='query'&&flags.write){emit(await queryMutation(workspace,parsed,querySql,client));return 0;}
  if(command==='query'){const result=await remoteQuery(workspace,parsed,querySql,client);await resultOutput(result.value,parsed,workspace.cwd,emit,stdout);return result.exitCode;}
  if(command==='delete'){emit(await deleteArtifact(workspace,positionals[0],client,{force:!!flags.force,dryRun:!!flags['dry-run']}));return 0;}
  if(command==='status'){emit(await remoteStatus(workspace,client));return 0;}
  if(command==='diff'){emit(await compare(workspace,positionals[0],client.connection.server,!!flags.remote,client));return 0;}
  if(command==='comment'){const result=await batchCommand(positionals,ref=>commentCommand(workspace,{command,flags,positionals:[ref]},client,commentBody));emit(result.value);return result.exitCode;}
  if(command==='list'&&flags.type==='session'){await resultOutput(await listAccountCollection(parsed,client),parsed,workspace.cwd,emit,stdout);return 0;}
  if(command==='list'){await resultOutput(await readCommand(workspace,parsed,client),parsed,workspace.cwd,emit,stdout);return 0;}
  if(command==='log'){const result=await batchCommand(positionals,ref=>readCommand(workspace,{command,flags,positionals:[ref]},client));emit(result.value);return result.exitCode;}
  if(command==='pull'){emit(await pull(workspace,positionals,client,{format:flags.format as string|undefined,output:flags.output as string|undefined,force:!!flags.force,dryRun:!!flags['dry-run']}));return 0;}
  if(command==='push'&&!account&&markdownPlan?.conversions.length&&!flags['dry-run']){await commitMarkdown(markdownPlan);workspace=await loadWorkspace(workspace.cwd);}
  if(command==='push'&&!account){emit(await push(workspace,positionals,client,{force:!!flags.force,dryRun:!!flags['dry-run']}));return 0;}
  if(command==='remote'){
   // The PTY graph is loaded only after the user selects remote execution.
   const {chooseLaunch}=await import('./launcher');const {runRemote}=await import('./runner');
   const launch=positionals.length?{command:positionals[0],args:positionals.slice(1)}:await chooseLaunch();
   return runRemote({connection,...launch,name:typeof flags.name==='string'?flags.name:undefined,onSession:url=>stderr(`Remote session: ${url}\n`)});
  }
  throw new CliError('command_integration_pending',`The ${command} command is still being integrated.`);
 }catch(error){
  const failure=error instanceof ApprovalRequired?{code:error.code,message:error.message,verification_url:error.verificationUrl,user_code:error.userCode,expires_at:new Date(error.expiresAt).toISOString()}:error instanceof CliError?{code:error.code,message:error.message,...(error.fix?{fix:error.fix}:{}),...(error.details?{details:error.details}:{})}:{code:'operation_failed',message:error instanceof Error?error.message:String(error)};
  if(json)stdout(JSON.stringify({error:failure})+'\n');
  stderr(`${failure.code}: ${failure.message}${'fix'in failure?`\n${failure.fix}`:''}\n`);
  return error instanceof CliError?error.exitCode:1;
 }
}
/** Seeded surface: the parser accepts these rows, and dispatch refuses them until their workstream lands. Each implementer deletes its own entries. */
const PENDING_TYPES:Record<string,readonly string[]>={list:['profile','table'],delete:['comment'],log:['artifact','folder','dataset','file']};
function pendingIntegration({command,positionals,flags}:ParsedCommand):void{
 const pending=(feature:string)=>{throw new CliError('command_integration_pending',`${feature} is not integrated yet.`,'See docs/cli-full-spec.md for the owning workstream.',{feature});};
 if(['fork','export','open'].includes(command))pending(`afbin ${command}`);
 if(typeof flags.type==='string'&&PENDING_TYPES[command]?.includes(flags.type))pending(`afbin ${command} --type ${flags.type}`);
 for(const flag of ['secret-env','session','page'])if(flags[flag]!==undefined)pending(`--${flag}`);
 if(command==='validate'&&flags.remote)pending('validate --remote');
 if(command==='diff'&&(flags.output!==undefined||positionals.length>1))pending('diff --output and multiple targets');
 if(command==='status'&&positionals.length)pending('status <ref>');
 if(command==='list'&&positionals.length)pending('list <ref>');
 if(command==='log'&&flags.filter!==undefined)pending('log --filter');
 if(['comment','query','update'].includes(command)&&flags['dry-run'])pending(`${command} --dry-run`);
 if(command==='help'&&(flags.format!==undefined||flags.output!==undefined))pending('help --format and --output');
}
async function readStdin():Promise<string>{const chunks:Buffer[]=[];for await(const chunk of process.stdin)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks).toString();}
