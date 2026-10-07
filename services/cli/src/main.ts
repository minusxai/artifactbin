import {installForegroundShutdown,installForegroundSupervisorShutdown} from './foreground-process';
import {TEAM_HOST_ARG,PREVIEW_HOST_ARG,LOCAL_IMAGE_ARG,LOCAL_HTML_ARG,REMOTE_WORKER_ARG,REMOTE_CONTEXT_ARG} from './entry-args';
import {reportStartupFailure} from './operator-error';
if(process.argv[2]===PREVIEW_HOST_ARG||process.argv[2]===TEAM_HOST_ARG)installForegroundShutdown();
else if(process.argv[2]==='preview'||process.argv[2]==='serve')installForegroundSupervisorShutdown();
// Intentional process-composition boundary: importing CLI/application modules before selecting the
// host process can capture the client's environment before the host installs its server configuration.
if(process.argv[2]===REMOTE_CONTEXT_ARG)void import('./remote-context-bridge').then(async({readRemoteContextBridge,remoteContextFailure})=>{
 try{
  const context=await readRemoteContextBridge(process.argv[3]??'',process.argv[4]??'');
  const {restoreRemoteContext}=await import('./config');restoreRemoteContext(context);
  const {runCli}=await import('./dispatch');process.exitCode=await runCli(process.argv.slice(5));
 }catch(error){const issue=remoteContextFailure(error);process.stderr.write(`${issue.code}: ${issue.message}\n`);if(process.argv.includes('--json'))process.stdout.write(JSON.stringify({error:issue})+'\n');process.exitCode=1;}
}).catch(error=>{reportStartupFailure(error);process.exitCode=1;});
else if(process.argv[2]===REMOTE_WORKER_ARG)void import('./remote-worker').then(({remoteWorkerMain})=>remoteWorkerMain()).catch(error=>{console.error(error instanceof Error?error.message:'Remote worker failed');process.exit(1);});
else if(process.argv[2]===LOCAL_IMAGE_ARG)void import('./local-image-runtime').then(({startLocalImageRuntime})=>startLocalImageRuntime(JSON.parse(process.argv[3]!),process.argv[4]!)).then(()=>process.exit(0)).catch(error=>{console.error(JSON.stringify({code:error.code??'render_failed',message:error.message}));process.exit(1);});
else if(process.argv[2]===LOCAL_HTML_ARG)void import('./local-html-runtime').then(({startLocalHtmlRuntime})=>startLocalHtmlRuntime(JSON.parse(process.argv[3]!),process.argv[4]!)).then(()=>process.exit(0)).catch(error=>{console.error(JSON.stringify({code:error.code??'render_failed',message:error.message}));process.exit(1);});
else if(process.argv[2]===PREVIEW_HOST_ARG)void import('./preview-runtime').then(({startPreviewRuntime})=>startPreviewRuntime(JSON.parse(process.argv[3]!),process.argv[4]!)).then(()=>process.exit(0)).catch(error=>{reportStartupFailure(error);process.exit(1);});
else if(process.argv[2]===TEAM_HOST_ARG)void import('./host-runtime').then(({startTeamRuntime})=>startTeamRuntime(process.argv[3]!,process.argv[4]!,JSON.parse(process.argv[5]??'{}'))).then(()=>process.exit(0)).catch(error=>{reportStartupFailure(error);process.exit(1);});
else void import('./dispatch').then(({runCli})=>runCli(process.argv.slice(2))).then(code=>{process.exitCode=code;});
