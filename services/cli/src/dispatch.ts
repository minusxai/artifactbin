import {addFiles,moveFile,localIdentities} from './identities';
import {servePreview} from './preview-runtime';
import {previewFiles,type PreviewOptions} from './preview-options';
import {serveTeam} from './host-runtime';
import type {ServeOptions} from './serve-config';
import { browserSessionCommand } from './browser-sessions';
import {scheduleBackgroundUpdate} from './background-update';
import {compareVersions,validVersion} from './version-order';
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
import {setupSkills,setupSummary,setupService} from './setup';
import {prepareMarkdown,commitMarkdown,type MarkdownPlan} from './markdown';
import {installSkills,planSkills,restartHints,selectSkills,type SkillChoice,type SkillHarness,skillStatus} from './skill-install';
import {CLI_VERSION} from './version';
import {CLI_PROTOCOL_VERSION} from '../../contracts/src/cli-auth';
import {readFile,realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {recoverFiles,stagedFiles} from './journal';
import {withLock} from './state';
import {pendingOperation} from './recoverable-operation';
import {homedir} from 'node:os';
import {parseCommand,CliError,type ParsedCommand} from './commands';
import {loadWorkspace,inspectWorkspace,type Workspace} from './workspace';
import {validateFiles} from './validation';
import {deleteComments} from './delete';
import {diffCommand,remoteStatus} from './comparison';
import {localStatus} from './local';
import {helpDocument,writeHelp,helpBundle} from './teaching';
import {withTeachingOrigin} from './teaching-origin';
import {validateMarkupStructure} from '../../app/lib/story/local-validation';
import type {JsxNode} from '../../app/lib/jsx';
import {helpScreen} from './help-screen';
import {colorSupport,createStyle,highlightJson,type Style,type StyleOptions} from './style';
import {DEFAULT_SERVER,loadConnectionFor,exportedServer,saveDefaultServer,readClientDefaults,setClientDefault} from './config';
import {sameServer,serverAddresses,serverIdentity,type ServerIdentity} from './server-identity';
import {browserAuthenticate,openBrowser,ApprovalRequired,type AuthOptions} from './browser-auth';
import {HttpClient} from './http';
import {resolveReference} from './reference';
import {preparePull,pull,pullToStdout} from './pull';
import {bindDatasetSecret} from './dataset-source';
import {finishSavedRequest,finishLocalPush,planPush,push} from './sync';
import {artifactReference,readCommand,commentCommand} from './read-commands';
import {readPendingRequest} from './pending-request';
export interface CliContext {preview?:(options:PreviewOptions)=>Promise<number>;team?:(options:ServeOptions)=>Promise<number>;auth?:Pick<AuthOptions,'open'|'now'|'sleep'>;env?:NodeJS.ProcessEnv;chooseSkills?:(choices:SkillChoice[])=>Promise<SkillHarness[]>;cwd?:string;home?:string;interactive?:boolean;color?:boolean;columns?:number;stdout?:(value:string)=>void;stdoutBytes?:(value:Uint8Array)=>void;stderr?:(value:string)=>void;fetch?:typeof fetch}
export async function runCli(argv:string[],context:CliContext={}):Promise<number>{
 const stdout=context.stdout??(value=>process.stdout.write(value));const stderr=context.stderr??(value=>process.stderr.write(value));
 // Colour only reaches a real terminal: a supplied writer stays plain unless the caller asks for colour.
 const styleOptions:StyleOptions=context.color!==undefined?{color:context.color}:context.stdout||context.stderr?{color:false}:colorSupport(context.env??process.env,!!process.stdout.isTTY);
 const columns=context.columns??process.stdout.columns;const style=createStyle(styleOptions);
 let parsed:ParsedCommand|undefined;let json=argv.includes('--json');
 try{
  parsed=parseCommand(argv);json=!!parsed.flags.json;
  const {command,positionals,flags}=parsed;
  let recoveredRequest:string|undefined;let markdownPlan:MarkdownPlan|undefined;let querySql:string|undefined;let secretBinding:Record<string,unknown>|undefined;
  const emit=(value:unknown)=>{if(markdownPlan?.conversions.length&&value&&typeof value==='object')value={...value,conversions:markdownPlan.conversions.map(x=>({source:x.source,path:x.target}))};if(recoveredRequest&&value&&typeof value==='object')value={...value,recovered_request:recoveredRequest};stdout(json?JSON.stringify(value)+'\n':typeof value==='string'?value.endsWith('\n')?value:value+'\n':highlightJson(JSON.stringify(value,null,2),style)+'\n');};
  if(flags.version){emit(json?{version:CLI_VERSION,protocol:CLI_PROTOCOL_VERSION}:`${style.wordmark('afbin')} ${style.bold(CLI_VERSION)} ${style.dim(`(protocol ${CLI_PROTOCOL_VERSION})`)}`);return 0;}
  const home=context.home??homedir();const interactive=context.interactive??!!process.stdin.isTTY;
  if(command==='serve'&&!flags.help){
   if(flags.server)throw new CliError('invalid_arguments','Use --config for server settings; --server selects a client destination.');
   const port=flags.port===undefined?undefined:Number(flags.port);
   if(port!==undefined&&(!Number.isInteger(port)||port<1||port>65535))throw new CliError('invalid_arguments','--port must be between 1 and 65535.');
   return await(context.team??serveTeam)({home,cwd:context.cwd??process.cwd(),...(typeof flags.config==='string'?{config:flags.config}:{}),...(typeof flags.dir==='string'?{directory:flags.dir}:{}),...(typeof flags['db-url']==='string'?{dbUrl:flags['db-url']}:{}),...(port===undefined?{}:{port})});
  }
  const defaults=await readClientDefaults(home,context.env);
  json=json||defaults.output==='json';
  if(json)flags.json=true;
  if(command==='preview'&&!flags.help){
   const port=Number(flags.port??0);if(!Number.isInteger(port)||port<0||port>65535)throw new CliError('invalid_arguments','--port must be an integer from 0 to 65535.');
   const workspace=await loadWorkspace(context.cwd,home),known=await localIdentities(workspace);
   const paths=await previewFiles(workspace.root,workspace.cwd,positionals.map(path=>known[path]?resolve(workspace.root,known[path]):path));
   // Preview registers local files against a server, so it crosses the same boundary the rest of the
   // CLI does: one identity, then the canonical origin for the binding, the credential and approval.
   const selected=typeof flags.server==='string'?flags.server:workspace.tracking?.server??defaults.host??DEFAULT_SERVER;
   const previewIdentity=await serverIdentity(selected,{home,env:context.env,...(context.fetch?{fetch:context.fetch}:{})});
   const server=previewIdentity.canonical;const previewAliases=serverAddresses(previewIdentity);
   if(workspace.tracking&&!sameServer(previewIdentity,workspace.tracking.server))
    throw new CliError('wrong_server',`wrong_server: this directory is tracked against ${workspace.tracking.server}; preview selected ${selected}.`,`Run preview from another directory, or pass --server ${workspace.tracking.server}.`);
   const connection=await loadConnectionFor(previewIdentity,home,context.env)??(workspace.tracking?{server,token:''}:await browserAuthenticate(server,{...context.auth,home,env:context.env,interactive,aliases:previewAliases,fetch:context.fetch,notify:message=>stderr(approvalMessage(message,style)+'\n')}));
   await addFiles(workspace,paths.map(path=>resolve(workspace.root,path)),new HttpClient({connection,home,env:context.env,fetch:context.fetch,account:workspace.tracking?.account,aliases:previewAliases}));
   return await(context.preview??servePreview)({cwd:workspace.root,home,paths,port,share:!!flags.share,json,server});
  }
  if(command==='config'&&!flags.help){
   const [action,key,value]=positionals;
   if(action==='set'&&positionals.length===3){emit(await setClientDefault(key!,value!,home,context.env));return 0;}
   if(action==='get'&&positionals.length===2){
    if(key==='host')emit({host:defaults.host??DEFAULT_SERVER});
    else if(key==='output')emit({output:defaults.output??'text'});
    else if(key==='updates')emit({updates:defaults.updates??true});
    else throw new CliError('invalid_arguments','Choose host, output, or updates.');
    return 0;
   }
   throw new CliError('invalid_arguments','Use afbin config get <key> or afbin config set <key> <value>.');
  }
  // The skill and the help text must name the server THIS afbin talks to. Eager
  // init and help both run before the workspace is read, so they use what is
  // knowable that early: an explicit --server, else the exported origin.
  // The recorded default (`.env`, written by `setup --server` from a self-hosted installer) selects a server
  // exactly as an exported ARTIFACTBIN_URL does: codex's `afbin pull <local url>` was still refused as
  // wrong_server on the first fixed build because only the connection loader read it.
  const exportedOrigin=await exportedServer(home,context.env);
  const declaredServer=typeof flags.server==='string'?flags.server:exportedOrigin??DEFAULT_SERVER;
  if(command!=='update'&&command!=='setup')await scheduleBackgroundUpdate({home,server:declaredServer,env:context.env});
  // Explicit setup must select first: eager initialization would install opted-out skills before the picker.
  if(command==='setup'&&!flags.help){
   if(flags.service){if(flags.harness)throw new CliError('invalid_arguments','Use --service separately from --harness.');const result=await setupService(String(flags.service));if(json)emit(result);else stdout(`${String(flags.service)} is ready for offline use.\n`);return 0;}
   // An installer served from a self-hosted origin runs `setup --server <origin>`: that origin becomes the default.
   // The default is stored as the deployment's CANONICAL origin when it publishes one, so an
   // installer served from a second hostname does not pin the folder to a name of the same server.
   if(typeof flags.server==='string')await saveDefaultServer((await serverIdentity(flags.server,{home,env:context.env,...(context.fetch?{fetch:context.fetch}:{})})).canonical,home,context.env);
   const result=await setupSkills({home,env:context.env,origin:declaredServer,interactive:interactive&&!json,yes:!!flags.yes,requested:flags.harness as string[]|undefined,choose:context.chooseSkills});
   if(json)emit(result);else stdout(setupSummary(result.installations,style));
   return 0;
  }
  // INIT is eager and local: every command first ensures the skill is installed for the detected/saved
  // harnesses. It never authenticates or touches the network, and is a no-op once the skill is current.
  if(command!=='setup')await ensureInit({home,env:context.env,origin:declaredServer,stderr,style});
  if(flags.help||command==='help'){
   const bundled=command==='help'?flags:{};
   const format=typeof bundled.format==='string'?bundled.format:'text';const topic=command==='help'?positionals[0]:command;
   // A person at a terminal gets the screens; automation, --json and --output keep the brief and plain text.
   const screen=!json&&format==='text'&&bundled.output===undefined&&interactive?helpScreen(topic,{...styleOptions,columns}):undefined;
   // Everything printed is addressed, by construction: the screens render the
   // command registry today, but a topic body reaching them must not print a
   // placeholder at a person.
   const text=typeof bundled.for==='string'?helpBundle(bundled.for,declaredServer):screen!==undefined?withTeachingOrigin(screen,declaredServer):helpDocument(topic,format,declaredServer);
   if(typeof bundled.output==='string'&&bundled.output!=='-'){emit(await writeHelp(text,bundled.output,context.cwd??process.cwd(),typeof bundled.format==='string'?bundled.format:'text'));return 0;}
   if(json){emit({help:text});return 0;}
   // The printed brief says its references are files beside SKILL.md; without the absolute path an agent
   // searched the whole filesystem for them (three tasks, 100–120 s each).
   const installed=!topic&&screen===undefined?(await skillStatus(await realpath(home),context.env)).filter(item=>item.installed).map(item=>item.path):[];
   emit(installed.length?`${text}\nInstalled skill: ${installed.join(', ')} — the same references, as files under references/ there.\n`:text);return 0;
  }
  let workspace=await loadWorkspace(context.cwd,home);
  if(command==='mv'){await moveFile(workspace,positionals[0]!,positionals[1]!);emit({moved:true});return 0;}
  const account=await accountPlan(workspace,parsed);
  if(account){const local=await localAccountCommand(workspace,parsed,account);if(local!==undefined){emit(local);return (local as {valid?:boolean}).valid===false?2:0;}}
  const chosenHost=()=>typeof flags.server==='string'?flags.server:workspace.tracking?.server??account?.manifest?.server??exportedOrigin;
  const serverOrigin=()=>chosenHost();
  /**
   * WHO THE SELECTED SERVER IS — resolved at most once per command, and only where it
   * matters: a comparison that would otherwise refuse, and the remote boundary below,
   * where the canonical origin becomes the one address this command talks to. Local
   * commands (help, validate, status, a dry run, an offline recovery) never reach it,
   * and a server that does not publish an identity leaves every one of them unchanged.
   */
  let identityPromise:Promise<ServerIdentity>|undefined;
  const identity=()=>identityPromise??=serverIdentity(serverOrigin()??declaredServer,{home,env:context.env,...(context.fetch?{fetch:context.fetch}:{})});
  // A pasted URL is the only ARGUMENT whose origin has to be understood before that boundary:
  // it may be another address of this same server, and it is used for its artifact id alone.
  const urlArgument=()=>[...positionals,...(typeof flags.in==='string'?[flags.in]:[])].some(ref=>/^https?:\/\//.test(ref));
  const addresses=async():Promise<string[]>=>urlArgument()?serverAddresses(await identity()):[];
  if(command==='update'){
   const selected=await selectSkills({home,env:context.env,interactive,yes:!!flags.yes,requested:flags.harness as string[]|undefined,choose:context.chooseSkills});
   const updated=await updateCli({home,server:chosenHost()??declaredServer,env:context.env,harnesses:selected,dryRun:!!flags['dry-run'],fetch:context.fetch});
   emit(updated);
   if('installations' in updated)for(const hint of restartHints(updated.installations))stderr(hint+'\n');
   return 0;
  }
  if(workspace.tracking&&typeof flags.server==='string'&&!['auth','update'].includes(command)){
   // Two names of ONE deployment are not two servers. Ask only when the strings differ.
   const compatible=flags.server===workspace.tracking.server||sameServer(await identity(),workspace.tracking.server);
   if(!compatible)throw new CliError('wrong_server',`This directory is tracked against ${workspace.tracking.server}; the command selected ${flags.server}.`,`Use another directory, or pass --server ${workspace.tracking.server}.`);
  }
  if(['push','pull','delete'].includes(command)&&(!account||command==='pull')&&!flags['dry-run']&&await pendingOperation(workspace))throw new CliError('pending_recovery','Recover the pending operation before changing this workspace.','Repeat the original command and inputs.');
  const pendingFiles=await stagedFiles(workspace.home,workspace.root);
  if(pendingFiles&&['push','pull','delete'].includes(command)&&!flags['dry-run']){
   await withLock(workspace.home,workspace.root,()=>recoverFiles(workspace.home,workspace.root));workspace=await loadWorkspace(context.cwd,home);
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
  if(command==='validate'&&!account){localValidation=await validateFiles(workspace,positionals,!!flags.fix);if(!flags.remote||!localValidation.valid){
   // One validate answers what an agent otherwise checks by hand: pi spent ten calls slicing its own viz
   // JSON out of the file with Python before pushing (local deck, 14 Sep).
   const verified=localValidation.valid?await verifiedSummary(workspace,positionals):undefined;
   emit({...localValidation,...(verified?{verified}:{})});return localValidation.valid?0:2;}}
  if(command==='status'&&!account&&!flags.remote){emit(await localStatus(workspace,positionals.length?positionals:undefined,home,context.env));return 0;}
  if(command==='diff'&&!account&&!flags.remote){
   try{const result=await diffCommand(workspace,parsed,serverOrigin()??declaredServer,false,stdout,undefined,style,await addresses());if(result)emit(result);return 0;}
   catch(error){if(!(error instanceof CliError)||error.code!=='network_required')throw error;}
  }
  if(command==='query'){
   // `afbin query <ref> 'select …'` reads as a natural call; as a second ref it ran the first target and buried the
   // refusal of the second under its rows. Refuse it before anything runs.
   const inlineSql=positionals.find(ref=>/^\s*(select|with|show|describe|explain|pragma)\b/i.test(ref));
   if(inlineSql!==undefined)throw new CliError('sql_in_argument',`sql_in_argument: SQL cannot be an argument: ${inlineSql.trim().slice(0,40)}…`);
   queryParameters(flags.param as string[]|undefined);
   querySql=typeof flags.input==='string'?(flags.input==='-'?await readStdin():await readFile(resolve(workspace.cwd,flags.input),'utf8')):undefined;
   const result=await localQuery(workspace,parsed,querySql,workspace.tracking?.server??serverOrigin()??declaredServer,await addresses());if(result){await resultOutput(result,parsed,workspace.cwd,emit,stdout,style);return 0;}
  }
  const selectedServer=serverOrigin()??declaredServer;
  // Resolved once here, and only when a URL argument makes it necessary; the remote boundary below resolves it anyway.
  const selectedAddresses=await addresses();
  const forkOptions=()=>({type:flags.type as string|undefined,output:flags.output as string|undefined,dryRun:!!flags['dry-run'],server:selectedServer,aliases:selectedAddresses});
  const exportOptions=()=>({og:!!flags.og,refresh:!!flags.refresh,type:flags.type as string|undefined,format:flags.format as string|undefined,output:flags.output as string|undefined,name:typeof flags.name==='string'?flags.name:undefined,page:flags.page!==undefined?Number(flags.page):undefined,force:!!flags.force,dryRun:!!flags['dry-run'],server:selectedServer,aliases:selectedAddresses,emit,...(context.stdoutBytes?{bytes:context.stdoutBytes}:{})});
  if(command==='fork'){const result=await forkResources(workspace,positionals,forkOptions());if(result){emit(result);return 0;}}
  if(command==='open'){
   const launch=context.auth?.open??openBrowser;
   emit(await openResources(workspace,positionals,{server:selectedServer,aliases:selectedAddresses,json,launch}));return 0;
  }
  if(command==='export'&&await exportResources(workspace,positionals,exportOptions()))return 0;
  if(['comment','log'].includes(command)||command==='delete'&&flags.type!=='session'&&flags.type!=='comment')for(const ref of positionals)await artifactReference(workspace,ref,selectedServer,command!=='log',selectedAddresses);
  if(command==='push'&&!account)for(const path of positionals)if(/@\d+$/.test(path))await resolveReference(path,{root:workspace.root,cwd:workspace.cwd,server:selectedServer,aliases:selectedAddresses,writable:true});
  if(command==='push'&&!account&&flags['dry-run']){const plans=await planPush(workspace,positionals,{force:!!flags.force,dryRun:true,access:flags.access as 'read'|'readwrite'|undefined,policy:flags.policy as 'viewers-write'|'none'|undefined});if(plans.every(plan=>plan.mode==='missing')){emit({dry_run:true,operations:plans.map(plan=>({path:plan.file.path,status:'skipped',reason:'missing_file'}))});return 0;}}
  if(command==='push'&&!account&&!flags['dry-run']){recoveredRequest=await finishSavedRequest(workspace,serverOrigin(),serverAddresses(await identity()));if(recoveredRequest)workspace=await loadWorkspace(workspace.cwd,workspace.home);}
  if(command==='push'&&!account&&!flags['dry-run']&&!await readPendingRequest(workspace.home,workspace.root)){
   const result=await finishLocalPush(workspace,positionals,{force:!!flags.force,access:flags.access as 'read'|'readwrite'|undefined,policy:flags.policy as 'viewers-write'|'none'|undefined});if(result){emit(result);return 0;}
  }
  if(command==='pull'&&!account){const targets=await preparePull(workspace,positionals,!!flags.force,serverOrigin(),flags.output as string|undefined,selectedAddresses);if(!targets.length){emit({operations:[]});return 0;}}
  let commentBody=typeof flags.body==='string'?flags.body:undefined;
  if(command==='comment'&&typeof flags.input==='string')commentBody=flags.input==='-'?await readStdin():await readFile(resolve(workspace.cwd,flags.input),'utf8');
  if(commentBody!==undefined&&(!commentBody.trim()||commentBody.length>100000))throw new CliError('invalid_comment','Comment text must contain 1–100000 characters.');
  /*
   * THE REMOTE BOUNDARY. From here every byte this command sends goes to ONE origin: the
   * canonical origin of the server the person selected. A second address of that same
   * deployment is only ever a name a link or a tracking record may carry — never a
   * destination, and never a place a credential is sent.
   */
  const resolved=await identity();
  const server=serverOrigin()===undefined?undefined:resolved.canonical;
  const serverAliases=serverAddresses(resolved);

  let connection=await loadConnectionFor(resolved,home,context.env);
  const authenticate=()=>browserAuthenticate(connection?.server??server??declaredServer,{...context.auth,home,env:context.env,interactive,aliases:serverAliases,rejectedToken:connection?.token,fetch:context.fetch,notify:message=>stderr(approvalMessage(message,style)+'\n')});
  if(command==='auth'){
   if(positionals[0]) {
    const ref=await resolveReference(positionals[0],{root:workspace.root,cwd:workspace.cwd,server:server??declaredServer,aliases:[...selectedAddresses],writable:true});
    if(ref.kind!=='id')throw new CliError('invalid_reference','Use the artifact URL or id for approval.');
    const authorized=await browserAuthenticate(server??declaredServer,{...context.auth,home,env:context.env,interactive,aliases:selectedAddresses,artifactId:ref.id,fetch:context.fetch,notify:message=>stderr(approvalMessage(message,style)+'\n')});
    emit({authenticated:true,authorized:true,artifactId:ref.id,server:authorized.server});return 0;
   }
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
  // A directory is tracked against ONE server and account. Sending another server this directory's account
  // got a bare 409 ("Use the credentials for this workspace account") that cost codex twenty steps of reading
  // login JavaScript. Name both origins and the way out before any request.
  if(workspace.tracking&&workspace.tracking.server!==connection.server&&!sameServer(resolved,workspace.tracking.server))throw new CliError('wrong_server',`wrong_server: this directory is tracked against ${workspace.tracking.server}; the command selected ${connection.server}.`,`Run it from another directory, or pass --server ${workspace.tracking.server}.`);
  const client=new HttpClient({connection,home,env:context.env,fetch:context.fetch,account:workspace.tracking?.account,aliases:serverAliases,readOnly:!!flags['dry-run'],...(!flags['dry-run']?{authenticate}: {})});
  if(command==='add'){emit(await addFiles(workspace,positionals,client));return 0;}
  if(command==='sessions'){
   const code=typeof flags.input==='string'?(flags.input==='-'?await readStdin():await readFile(resolve(workspace.cwd,flags.input),'utf8')):undefined;
   const result=await browserSessionCommand(client,positionals[0],positionals[1],{code,execution:typeof flags.execution==='string'?flags.execution:undefined,...(flags.as==='guest'?{viewer:'guest' as const}:{}),progress:stderr});
   emit(result);return result.error?1:0;
  }
  if(account){const result=await remoteAccountCommand(workspace,parsed,account,client);if(result.content!==undefined)stdout(result.content);else emit(result.value);return result.exitCode??0;}
  if(command==='fork'){emit(await forkResources(workspace,positionals,{...forkOptions(),client}));return 0;}
  if(command==='export'){await exportResources(workspace,positionals,{...exportOptions(),client});return 0;}
  if(command==='query'&&flags.write){emit(await queryMutation(workspace,parsed,querySql,client));return 0;}
  if(command==='query'){const result=await mixedQuery(workspace,parsed,querySql,client);await resultOutput(result.value,parsed,workspace.cwd,emit,stdout,style);return result.exitCode;}
  if(command==='validate'){const remote=await push(workspace,positionals,client,{dryRun:true});const valid=!!localValidation?.valid&&remote.operations.every(op=>!('error' in op));emit({...localValidation,valid,remote:remote.operations});return valid?0:2;}
  if(command==='delete'&&flags.type==='comment'){const result=await deleteComments(workspace,String(flags.in),positionals,client,{dryRun:!!flags['dry-run']});emit(result.value);return result.exitCode;}
  if(command==='status'){emit(await remoteStatus(workspace,client,home,context.env));return 0;}
  if(command==='diff'){const result=await diffCommand(workspace,parsed,client.connection.server,!!flags.remote,stdout,client,style);if(result)emit(result);return 0;}
  if(command==='comment'){const result=await batchCommand(positionals,ref=>commentCommand(workspace,{command,flags,positionals:[ref]},client,commentBody));emit(result.value);return result.exitCode;}
  if(command==='list'&&flags.type==='profile'){await resultOutput(await client.request('/account/profile'),parsed,workspace.cwd,emit,stdout,style);return 0;}
  if(command==='list'&&flags.type==='session'){await resultOutput(await listAccountCollection(parsed,client),parsed,workspace.cwd,emit,stdout,style);return 0;}
  if(command==='list'&&flags.type==='table'){await resultOutput(await discoverTables(workspace,parsed,client),parsed,workspace.cwd,emit,stdout,style);return 0;}
  if(command==='list'&&positionals.length){const result=await batchCommand(positionals,ref=>readCommand(workspace,{command,flags,positionals:[ref]},client));await resultOutput(result.value,parsed,workspace.cwd,emit,stdout,style);return result.exitCode;}
  if(command==='list'){await resultOutput(await readCommand(workspace,parsed,client),parsed,workspace.cwd,emit,stdout,style);return 0;}
  if(command==='log'){const result=await batchCommand(positionals,ref=>readCommand(workspace,{command,flags,positionals:[ref]},client));emit(result.value);return result.exitCode;}
  if(command==='pull'&&flags.output==='-'){const result=await pullToStdout(workspace,positionals,client,parsed,stdout);if(result)emit(result);return 0;}
  if(command==='pull'){emit(await pull(workspace,positionals,client,{format:flags.format as string|undefined,output:flags.output as string|undefined,force:!!flags.force,dryRun:!!flags['dry-run'],type:flags.type as string|undefined}));return 0;}
  if(command==='push'&&!account&&typeof flags['secret-env']==='string'){secretBinding=await bindDatasetSecret(workspace,positionals,client,context.env??process.env,flags['secret-env'],!!flags['dry-run']);if(secretBinding.dry_run){emit(secretBinding);return 0;}}
  if(command==='push'&&!account&&markdownPlan?.conversions.length&&!flags['dry-run']){await commitMarkdown(markdownPlan);workspace=await loadWorkspace(workspace.cwd,workspace.home);}
  if(command==='push'&&!account){
   if(!flags['dry-run']){const selected=await inspectWorkspace(workspace,positionals.length?positionals:undefined);await addFiles(workspace,selected.filter(file=>file.bytes&&!file.tracked&&!file.document?.metadata.head_version&&!file.resource?.head_version).map(file=>resolve(workspace.root,file.path)),client);workspace=await loadWorkspace(workspace.cwd,home);}
   const result=await push(workspace,positionals,client,{force:!!flags.force,dryRun:!!flags['dry-run'],access:flags.access as 'read'|'readwrite'|undefined,policy:flags.policy as 'viewers-write'|'none'|undefined});
   // The moment the verification loop starts: after a publish, agents re-pulled, diffed, exported and
   // grepped their own document for 5–13 calls. Say it once, here.
   const published=!flags['dry-run']&&result.operations.some(op=>'status' in op&&op.status==='published');
   // What the door checked before it accepted the document, so the agent that wants proof has it here
   // and does not go and gather it: pi curled the page for the title, grepped for the chart spec and
   // re-ran its queries for five calls after a successful push (local hardcore report, 14 Sep).
   const verified=published?await verifiedSummary(workspace,positionals):undefined;
   emit({...result,...(verified?{verified}:{}),...(published?{next:publishedNext(verified)}:{}),...(secretBinding?{secret_binding:secretBinding}:{})});return 0;
  }
  if(command==='remote'&&typeof flags.session==='string'){
   const {attachRemote}=await import('./attach');
   return attachRemote({client,id:flags.session,interactive,stdout,onSession:url=>stderr(`Remote session: ${style.cyan(url)}\n`)});
  }
  if(command==='remote'){
   // The PTY graph is loaded only after the user selects remote execution.
   const {chooseLaunch}=await import('./launcher');const {runRemote}=await import('./runner');
   const launch=positionals.length?{command:positionals[0],args:positionals.slice(1)}:await chooseLaunch();
   return runRemote({client,...launch,name:typeof flags.name==='string'?flags.name:undefined,onSession:url=>stderr(`Remote session: ${style.cyan(url)}\n`)});
  }
  throw new CliError('command_integration_pending',`The ${command} command is still being integrated.`);
 }catch(error){
  const failure=error instanceof ApprovalRequired?{code:error.code,message:error.message,verification_url:error.verificationUrl,user_code:error.userCode,expires_at:new Date(error.expiresAt).toISOString()}:error instanceof CliError?{code:error.code,message:error.message,...(error.fix?{fix:error.fix}:{}),...(error.details?{details:error.details}:{})}:{code:'operation_failed',message:error instanceof Error?error.message:String(error)};
  if(json)stdout(JSON.stringify({error:failure})+'\n');
  const diagnosed=refusalDetails(failure.message,'details'in failure?failure.details:undefined);
  stderr(`${style.red(style.bold(failure.code))}: ${withoutCode(failure.code,failure.message)}${diagnosed.length?`\n${diagnosed.join('\n')}`:''}${'fix'in failure&&failure.fix?`\n${style.dim(failure.fix)}`:''}\n`);
  return error instanceof CliError?error.exitCode:1;
 }
}
/**
 * THE CODE, ONCE. A refusal's message carries its own code wherever it is read — `http.ts` builds it
 * as `<code>: <text>` so a message quoted on its own still names what was refused — and this printer
 * puts the code in front of every human line. Together they read `invalid_sql: invalid_sql: …`.
 *
 * The fix belongs HERE, in the one place a refusal becomes human text, and not in `http.ts`: the
 * message is also the `--json` envelope's `message`, which callers and tests read, so trimming it at
 * the source would change the contract to fix the presentation. The printed line drops a prefix the
 * printer is about to write itself; nothing else sees a different string.
 */
const withoutCode=(code:string,message:string):string=>message.startsWith(`${code}: `)?message.slice(code.length+2):message;
/** How many failing files a refusal names before it stops; the rest are one counted line. */
const MAX_REFUSAL_FILES=3;
/**
 * THE DIAGNOSIS THE REFUSAL ALREADY CARRIES, as human lines.
 *
 * Every CliError may hold `details`, and `--json` has always printed them; the human text printed
 * the message and the fix and nothing else. So a refused push read
 *
 *     validation_failed: Local validation failed.
 *     Run afbin validate and correct the reported errors.
 *
 * and the agent's next call was `afbin validate` — a whole turn to READ a message it had already
 * been handed. Two shapes reach here and both
 * are already in hand: a local validation's per-file diagnostics, and the `details` strings a server
 * refusal carries (a bad column, a refused SQL function).
 *
 * Printed ONCE: `http.ts` builds the message out of those same strings when the server sends no
 * message of its own, so a line the message already contains is dropped rather than repeated. Only
 * the two known shapes are read — `{http_status:401}` on auth_required is a detail for `--json`,
 * not a line for a person — and a repair NOTICE is not a failure, so it is not the file's diagnostic.
 */
function refusalDetails(message:string,details:unknown):string[]{
 if(!details||typeof details!=='object')return [];
 const lines:string[]=[];
 const files=(details as {files?:unknown}).files;
 if(Array.isArray(files)){
  const failed=files.filter((file):file is {path:string;diagnostics:Array<{message?:unknown;severity?:unknown}>}=>
   !!file&&typeof file==='object'&&(file as {valid?:unknown}).valid===false&&typeof (file as {path?:unknown}).path==='string'&&Array.isArray((file as {diagnostics?:unknown}).diagnostics));
  for(const file of failed.slice(0,MAX_REFUSAL_FILES)){
   const first=file.diagnostics.find(diagnostic=>!!diagnostic&&typeof diagnostic.message==='string'&&diagnostic.severity!=='notice');
   if(first)lines.push(`${file.path}: ${first.message as string}`);
  }
  if(failed.length>MAX_REFUSAL_FILES)lines.push(`… and ${failed.length-MAX_REFUSAL_FILES} more files; run afbin validate for the rest.`);
 }
 const strings=(details as {details?:unknown}).details;
 if(Array.isArray(strings))lines.push(...strings.filter((detail):detail is string=>typeof detail==='string'));
 return lines.filter(line=>!message.includes(line));
}
/** Printed with every publish: the head is the file that was pushed, so checking it is a wasted turn. */
export const PUBLISHED_NEXT='Published: the head is exactly the file you pushed. Do not pull, diff, export or grep it to verify; to improve it, edit and push again. If you must look, one `afbin export <id> --output out.png` shows the whole document, every slide, in one image.';
/**
 * A push proves markup and read queries. It never runs a write, so a page that declares one is
 * told so by name: the measured rule above is for documents, and an untested button is how a
 * person ends up debugging the page for the agent.
 */
function publishedNext(verified:Awaited<ReturnType<typeof verifiedSummary>>):string{
 const writes=[...new Set((verified??[]).flatMap(file=>file.writes??[]))];
 return writes.length?`${PUBLISHED_NEXT} This page declares ${writes.length===1?'a write':'writes'} (${writes.join(', ')}) that the push did not run: run each once in a live session, as yourself and with --as guest (afbin help live-sessions), fix and push again before handing it over.`:PUBLISHED_NEXT;
}
/** The pushed documents' title, queries, charts and markup — all checked by the server before it accepted them. */
async function verifiedSummary(workspace:Workspace,paths:string[]):Promise<Array<{path:string;title:string|null;queries:string[];charts:number;checks:string[];writes?:string[]}>|undefined>{
 const out:Array<{path:string;title:string|null;queries:string[];charts:number;checks:string[];writes?:string[]}>=[];
 for(const file of await inspectWorkspace(workspace,paths)){
  if(!file.document||!file.bytes)continue;
  const {split}=validateMarkupStructure(file.document.body);if(!split)continue;
  let charts=0;const count=(nodes:JsxNode[])=>{for(const n of nodes){if(n.type!=='element')continue;if(n.tag==='Question')charts++;count(n.children);}};count(split.body);
  const queries=split.content.queries.map(query=>query.name);
  const writes=(split.content.mutations??[]).map(mutation=>mutation.name);
  out.push({path:file.path,title:split.content.title??file.document.metadata.title??null,queries,charts,...(writes.length?{writes}:{}),
   checks:['markup validated',...(queries.length?[`${queries.length} quer${queries.length===1?'y':'ies'} dry-run against the published dataset`]:[]),...(charts?[`${charts} chart${charts===1?'':'s'} checked against query columns`]:[]),...(writes.length?[`${writes.length} write${writes.length===1?'':'s'} declared, not run`]:[]),'title and metadata accepted']});
 }
 return out.length?out:undefined;
}
async function readStdin():Promise<string>{const chunks:Buffer[]=[];for await(const chunk of process.stdin)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks).toString();}
/**
 * Eager, offline skill installation for the detected or saved harnesses. Runs before every command,
 * never prompts (selection is non-interactive here) and never authenticates. Idempotent: it installs
 * only when the managed skill manifest is missing or stale, and stays silent otherwise.
 */
async function ensureInit(options:{home:string;env?:NodeJS.ProcessEnv;origin?:string;stderr:(value:string)=>void;style:Style}):Promise<void>{
 const selected=await selectSkills({home:options.home,env:options.env,interactive:false});
 if(!selected.length)return;
 const plans=await planSkills(selected,{home:options.home,env:options.env,origin:options.origin});
 // Eager init installs a MISSING or version-stale skill. A skill addressed to another server is
 // `afbin setup`'s decision: without this gate, a command run with --server against a second
 // server rewrites every harness's skill files on every invocation.
 const stale=plans.filter(plan=>plan.status==='install'||(plan.status==='update'&&(!validVersion(plan.installed)||compareVersions(plan.installed,plan.version)<0)));
 if(!stale.length)return;
 const installed=await installSkills(stale.map(plan=>plan.harness),{home:options.home,env:options.env,origin:options.origin,preserveSelection:true});
 for(const item of installed.installations)if(item.status!=='unchanged')options.stderr(`${options.style.green(`Skill ${item.status}:`)} ${item.path}${item.backup?` (backup: ${item.backup})`:''}\n`);
 for(const hint of restartHints(installed.installations))options.stderr(options.style.yellow(hint)+'\n');
}
/** The approval sentence keeps its words; the code and the URL stand out on a terminal. */
function approvalMessage(message:string,style:Style):string{
 return message.replace(/https?:\/\/[^\s,]+/g,url=>style.cyan(url)).replace(/\bcode (\S+)/,(_,code)=>`code ${style.bold(code)}`);
}
