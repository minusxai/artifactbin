import {accountPlan,listAccountCollection,localAccountCommand,remoteAccountCommand} from './account-workspace';
import {forkResources} from './fork';
import {exportResources} from './export';
import {openResources} from './open';
import {discoverTables,mixedQuery} from './remote-query';
import {batchCommand} from './batch';
import {resultOutput} from './result-output';
import {queryMutation} from './mutation-command';
import {localQuery,queryParameters} from './local-query';
import {updateCli} from './update';
import {prepareMarkdown,commitMarkdown,type MarkdownPlan} from './markdown';
import {installSkills,planSkills,restartHints,selectSkills,type SkillChoice,type SkillHarness} from './skill-install';
import {CLI_VERSION} from './version';
import {CLI_PROTOCOL_VERSION} from '../../contracts/src/cli-auth';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {readOptional} from './files';
import {recoverFiles} from './journal';
import {withLock} from './state';
import {homedir} from 'node:os';
import {parseCommand,CliError,type ParsedCommand} from './commands';
import {loadWorkspace} from './workspace';
import {validateFiles} from './validation';
import {deleteComments} from './delete';
import {diffCommand,remoteStatus} from './comparison';
import {localStatus} from './local';
import {helpDocument,writeHelp} from './teaching';
import {loadConnection} from './config';
import {browserAuthenticate,openBrowser,ApprovalRequired,type AuthOptions} from './browser-auth';
import {HttpClient} from './http';
import {resolveReference} from './reference';
import {preparePull,pull,pullToStdout} from './pull';
import {bindDatasetSecret} from './dataset-source';
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
  let recoveredRequest:string|undefined;let markdownPlan:MarkdownPlan|undefined;let querySql:string|undefined;let secretBinding:Record<string,unknown>|undefined;
  const emit=(value:unknown)=>{if(markdownPlan?.conversions.length&&value&&typeof value==='object')value={...value,conversions:markdownPlan.conversions.map(x=>({source:x.source,path:x.target}))};if(recoveredRequest&&value&&typeof value==='object')value={...value,recovered_request:recoveredRequest};stdout(json?JSON.stringify(value)+'\n':typeof value==='string'?value.endsWith('\n')?value:value+'\n':JSON.stringify(value,null,2)+'\n');};
  if(flags.version){emit(json?{version:CLI_VERSION,protocol:CLI_PROTOCOL_VERSION}:`afbin ${CLI_VERSION} (protocol ${CLI_PROTOCOL_VERSION})`);return 0;}
  const home=context.home??homedir();const interactive=context.interactive??!!process.stdin.isTTY;
  // INIT is eager and local: every command first ensures the skill is installed for the detected/saved
  // harnesses. It never authenticates or touches the network, and is a no-op once the skill is current.
  await ensureInit({home,env:context.env,stderr});
  if(flags.help||command==='help'){
   const bundled=command==='help'?flags:{};
   const text=helpDocument(command==='help'?positionals[0]:command,typeof bundled.format==='string'?bundled.format:'text');
   if(typeof bundled.output==='string'&&bundled.output!=='-'){emit(await writeHelp(text,bundled.output,context.cwd??process.cwd(),typeof bundled.format==='string'?bundled.format:'text'));return 0;}
   emit(json?{help:text}:text);return 0;
  }
  let workspace=await loadWorkspace(context.cwd,home);
  const account=await accountPlan(workspace,parsed);
  if(account){const local=await localAccountCommand(workspace,parsed,account);if(local!==undefined){emit(local);return (local as {valid?:boolean}).valid===false?2:0;}}
  const serverOrigin=()=>typeof flags.server==='string'?flags.server:workspace.lock?.server??account?.manifest?.server??(context.env??process.env).ARTIFACTBIN_URL;
  if(['push','pull','delete'].includes(command)&&(!account||command==='pull')&&!flags['dry-run']&&await readOptional(join(workspace.root,'.artifactbin','pending-operation.json')))throw new CliError('pending_recovery','Recover the pending operation before changing this workspace.','Repeat the original command and inputs.');
  const pendingFiles=await readOptional(join(workspace.root,'.artifactbin','pending-files.json'));
  if(pendingFiles&&['push','pull','delete'].includes(command)&&!flags['dry-run']){
   await withLock(workspace.home,workspace.root,()=>recoverFiles(workspace.root));workspace=await loadWorkspace(context.cwd,home);
  }
  if(pendingFiles&&command==='validate'&&flags.fix)throw new CliError('pending_recovery','Finish the interrupted file commit before applying fixes.','Run afbin push or afbin pull to recover it.');
  if(!account&&(command==='push'||command==='validate')){
   markdownPlan=await prepareMarkdown(workspace,positionals);
   if(markdownPlan.conversions.length){
    if(command==='validate'&&flags.fix)throw new CliError('unsupported_flag','Markdown conversion is a one-time push operation; validate --fix edits JSX only.','Run afbin validate file.md to preview validation, or afbin push file.md to convert it.');
    workspace=markdownPlan.workspace;positionals.splice(0,positionals.length,...markdownPlan.paths);
   }
  }
  let localValidation:Awaited<ReturnType<typeof validateFiles>>|undefined;
  if(command==='validate'&&!account){localValidation=await validateFiles(workspace,positionals,!!flags.fix);if(!flags.remote||!localValidation.valid){emit(localValidation);return localValidation.valid?0:2;}}
  if(command==='status'&&!account&&!flags.remote){emit(await localStatus(workspace,positionals.length?positionals:undefined,home,context.env));return 0;}
  if(command==='diff'&&!account&&!flags.remote){
   try{const result=await diffCommand(workspace,parsed,serverOrigin()??'https://artifactbin.dev',false,stdout);if(result)emit(result);return 0;}
   catch(error){if(!(error instanceof CliError)||error.code!=='network_required')throw error;}
  }
  const selectedServer=serverOrigin()??'https://artifactbin.dev';
  const forkOptions=()=>({type:flags.type as string|undefined,output:flags.output as string|undefined,dryRun:!!flags['dry-run'],server:selectedServer});
  const exportOptions=()=>({type:flags.type as string|undefined,format:flags.format as string|undefined,output:flags.output as string|undefined,name:typeof flags.name==='string'?flags.name:undefined,page:flags.page!==undefined?Number(flags.page):undefined,force:!!flags.force,dryRun:!!flags['dry-run'],server:selectedServer,emit,...(context.stdoutBytes?{bytes:context.stdoutBytes}:{})});
  if(command==='fork'){const result=await forkResources(workspace,positionals,forkOptions());if(result){emit(result);return 0;}}
  if(command==='open'){emit(await openResources(workspace,positionals,{server:selectedServer,noBrowser:!!flags['no-browser'],json,launch:context.auth?.open??openBrowser}));return 0;}
  if(command==='export'&&await exportResources(workspace,positionals,exportOptions()))return 0;
  if(command==='query'){
   queryParameters(flags.param as string[]|undefined);
   querySql=typeof flags.input==='string'?(flags.input==='-'?await readStdin():await readFile(resolve(workspace.cwd,flags.input),'utf8')):undefined;
   const result=await localQuery(workspace,parsed,querySql,selectedServer);if(result){await resultOutput(result,parsed,workspace.cwd,emit,stdout);return 0;}
  }
  if(['comment','log'].includes(command)||command==='delete'&&flags.type!=='session'&&flags.type!=='comment')for(const ref of positionals)await artifactReference(workspace,ref,selectedServer,command!=='log');
  if(command==='push'&&!account)for(const path of positionals)if(/@\d+$/.test(path))await resolveReference(path,{root:workspace.root,cwd:workspace.cwd,server:selectedServer,writable:true});
  if(command==='push'&&!account&&flags['dry-run']){const plans=await planPush(workspace,positionals,{force:!!flags.force,dryRun:true});if(plans.every(plan=>plan.mode==='missing')){emit({dry_run:true,operations:plans.map(plan=>({path:plan.file.path,status:'skipped',reason:'missing_file'}))});return 0;}}
  if(command==='push'&&!account&&!flags['dry-run']){recoveredRequest=await finishSavedRequest(workspace,serverOrigin());if(recoveredRequest)workspace=await loadWorkspace(workspace.cwd,workspace.home);}
  if(command==='push'&&!account&&!flags['dry-run']&&!await readPendingRequest(workspace.root)){
   const result=await finishLocalPush(workspace,positionals,!!flags.force);if(result){emit(result);return 0;}
  }
  if(command==='pull'&&!account){const targets=await preparePull(workspace,positionals,!!flags.force,serverOrigin(),flags.output as string|undefined);if(!targets.length){emit({operations:[]});return 0;}}
  let commentBody=typeof flags.body==='string'?flags.body:undefined;
  if(command==='comment'&&typeof flags.input==='string')commentBody=flags.input==='-'?await readStdin():await readFile(resolve(workspace.cwd,flags.input),'utf8');
  if(commentBody!==undefined&&(!commentBody.trim()||commentBody.length>100000))throw new CliError('invalid_comment','Comment text must contain 1–100000 characters.');
  const server=serverOrigin();
  if(command==='update'){
   const selected=await selectSkills({home,env:context.env,interactive,yes:!!flags.yes,requested:flags.harness as string[]|undefined,choose:context.chooseSkills});
   const updated=await updateCli({home,server:server??'https://artifactbin.dev',env:context.env,harnesses:selected,dryRun:!!flags['dry-run'],fetch:context.fetch});
   emit(updated);
   if('installations' in updated)for(const hint of restartHints(updated.installations))stderr(hint+'\n');
   return 0;
  }
  let connection=await loadConnection(server,home,context.env);
  const authenticate=()=>browserAuthenticate(connection?.server??server??'https://artifactbin.dev',{...context.auth,home,env:context.env,interactive,noBrowser:!!flags['no-browser'],rejectedToken:connection?.token,fetch:context.fetch,notify:message=>stderr(message+'\n')});
  if(command==='auth'){
   // AUTH is lazy and idempotent. A saved token is verified with one read and its account reported;
   // no token or a rejected one runs the same browser approval the rest of the CLI uses on 401.
   if(connection){
    const probe=new HttpClient({connection,home,env:context.env,fetch:context.fetch});
    try{await probe.request('/artifacts?limit=1');emit({authenticated:true,server:probe.connection.server,account:probe.account??'anonymous'});return 0;}
    catch(error){if(!(error instanceof CliError)||error.code!=='auth_required')throw error;}
   }
   connection=await authenticate();
   emit({authenticated:true,server:connection.server});return 0;
  }
  if(!connection){
   if(flags['dry-run'])throw new CliError('auth_required','Sign-in is required for this operation.','Run afbin auth, or set ARTIFACTBIN_TOKEN for the selected server.');
   connection=await authenticate();
  }
  const client=new HttpClient({connection,home,env:context.env,fetch:context.fetch,account:workspace.lock?.account,readOnly:!!flags['dry-run'],...(!flags['dry-run']?{authenticate}: {})});
  if(account){const result=await remoteAccountCommand(workspace,parsed,account,client);if(result.content!==undefined)stdout(result.content);else emit(result.value);return result.exitCode??0;}
  if(command==='fork'){emit(await forkResources(workspace,positionals,{...forkOptions(),client}));return 0;}
  if(command==='export'){await exportResources(workspace,positionals,{...exportOptions(),client});return 0;}
  if(command==='query'&&flags.write){emit(await queryMutation(workspace,parsed,querySql,client));return 0;}
  if(command==='query'){const result=await mixedQuery(workspace,parsed,querySql,client);await resultOutput(result.value,parsed,workspace.cwd,emit,stdout);return result.exitCode;}
  if(command==='validate'){const remote=await push(workspace,positionals,client,{dryRun:true});const valid=!!localValidation?.valid&&remote.operations.every(op=>!('error' in op));emit({...localValidation,valid,remote:remote.operations});return valid?0:2;}
  if(command==='delete'&&flags.type==='comment'){const result=await deleteComments(workspace,String(flags.in),positionals,client,{dryRun:!!flags['dry-run']});emit(result.value);return result.exitCode;}
  if(command==='status'){emit(await remoteStatus(workspace,client,home,context.env));return 0;}
  if(command==='diff'){const result=await diffCommand(workspace,parsed,client.connection.server,!!flags.remote,stdout,client);if(result)emit(result);return 0;}
  if(command==='comment'){const result=await batchCommand(positionals,ref=>commentCommand(workspace,{command,flags,positionals:[ref]},client,commentBody));emit(result.value);return result.exitCode;}
  if(command==='list'&&flags.type==='profile'){await resultOutput(await client.request('/account/profile'),parsed,workspace.cwd,emit,stdout);return 0;}
  if(command==='list'&&flags.type==='session'){await resultOutput(await listAccountCollection(parsed,client),parsed,workspace.cwd,emit,stdout);return 0;}
  if(command==='list'&&flags.type==='table'){await resultOutput(await discoverTables(workspace,parsed,client),parsed,workspace.cwd,emit,stdout);return 0;}
  if(command==='list'&&positionals.length){const result=await batchCommand(positionals,ref=>readCommand(workspace,{command,flags,positionals:[ref]},client));await resultOutput(result.value,parsed,workspace.cwd,emit,stdout);return result.exitCode;}
  if(command==='list'){await resultOutput(await readCommand(workspace,parsed,client),parsed,workspace.cwd,emit,stdout);return 0;}
  if(command==='log'){const result=await batchCommand(positionals,ref=>readCommand(workspace,{command,flags,positionals:[ref]},client));emit(result.value);return result.exitCode;}
  if(command==='pull'&&flags.output==='-'){const result=await pullToStdout(workspace,positionals,client,parsed,stdout);if(result)emit(result);return 0;}
  if(command==='pull'){emit(await pull(workspace,positionals,client,{format:flags.format as string|undefined,output:flags.output as string|undefined,force:!!flags.force,dryRun:!!flags['dry-run'],type:flags.type as string|undefined}));return 0;}
  if(command==='push'&&!account&&typeof flags['secret-env']==='string'){secretBinding=await bindDatasetSecret(workspace,positionals,client,context.env??process.env,flags['secret-env'],!!flags['dry-run']);if(secretBinding.dry_run){emit(secretBinding);return 0;}}
  if(command==='push'&&!account&&markdownPlan?.conversions.length&&!flags['dry-run']){await commitMarkdown(markdownPlan);workspace=await loadWorkspace(workspace.cwd,workspace.home);}
  if(command==='push'&&!account){emit({...await push(workspace,positionals,client,{force:!!flags.force,dryRun:!!flags['dry-run']}),...(secretBinding?{secret_binding:secretBinding}:{})});return 0;}
  if(command==='remote'&&typeof flags.session==='string'){
   const {attachRemote}=await import('./attach');
   return attachRemote({client,id:flags.session,interactive,stdout,onSession:url=>stderr(`Remote session: ${url}\n`)});
  }
  if(command==='remote'){
   // The PTY graph is loaded only after the user selects remote execution.
   const {chooseLaunch}=await import('./launcher');const {runRemote}=await import('./runner');
   const launch=positionals.length?{command:positionals[0],args:positionals.slice(1)}:await chooseLaunch();
   return runRemote({client,...launch,name:typeof flags.name==='string'?flags.name:undefined,onSession:url=>stderr(`Remote session: ${url}\n`)});
  }
  throw new CliError('command_integration_pending',`The ${command} command is still being integrated.`);
 }catch(error){
  const failure=error instanceof ApprovalRequired?{code:error.code,message:error.message,verification_url:error.verificationUrl,user_code:error.userCode,expires_at:new Date(error.expiresAt).toISOString()}:error instanceof CliError?{code:error.code,message:error.message,...(error.fix?{fix:error.fix}:{}),...(error.details?{details:error.details}:{})}:{code:'operation_failed',message:error instanceof Error?error.message:String(error)};
  if(json)stdout(JSON.stringify({error:failure})+'\n');
  stderr(`${failure.code}: ${failure.message}${'fix'in failure?`\n${failure.fix}`:''}\n`);
  return error instanceof CliError?error.exitCode:1;
 }
}
async function readStdin():Promise<string>{const chunks:Buffer[]=[];for await(const chunk of process.stdin)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks).toString();}
/**
 * Eager, offline skill installation for the detected or saved harnesses. Runs before every command,
 * never prompts (selection is non-interactive here) and never authenticates. Idempotent: it installs
 * only when the managed skill manifest is missing or stale, and stays silent otherwise.
 */
async function ensureInit(options:{home:string;env?:NodeJS.ProcessEnv;stderr:(value:string)=>void}):Promise<void>{
 const selected=await selectSkills({home:options.home,env:options.env,interactive:false});
 if(!selected.length)return;
 const plans=await planSkills(selected,{home:options.home,env:options.env});
 if(plans.every(plan=>plan.status==='unchanged'))return;
 const installed=await installSkills(selected,{home:options.home,env:options.env});
 for(const item of installed.installations)if(item.status!=='unchanged')options.stderr(`Skill ${item.status}: ${item.path}${item.backup?` (backup: ${item.backup})`:''}\n`);
 for(const hint of restartHints(installed.installations))options.stderr(hint+'\n');
}
