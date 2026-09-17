import {BACKGROUND_UPDATE_ARG,TEAM_HOST_ARG,PREVIEW_HOST_ARG,LOCAL_IMAGE_ARG} from './entry-args';
// Intentional process-composition boundary: importing CLI/application modules before selecting the
// host process can capture the client's environment before the host installs its server configuration.
if(process.argv[2]==='--internal-browser-worker')void import('./browser-worker-entry').then(({startBrowserWorker})=>startBrowserWorker()).catch(error=>{console.error(error);process.exit(1);});
else if(process.argv[2]===LOCAL_IMAGE_ARG)void import('./local-image-runtime').then(({startLocalImageRuntime})=>startLocalImageRuntime(JSON.parse(process.argv[3]!),process.argv[4]!)).then(()=>process.exit(0)).catch(error=>{console.error(JSON.stringify({code:error.code??'render_failed',message:error.message}));process.exit(1);});
else if(process.argv[2]===PREVIEW_HOST_ARG)void import('./preview-runtime').then(({startPreviewRuntime})=>startPreviewRuntime(JSON.parse(process.argv[3]!),process.argv[4]!)).then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
else if(process.argv[2]===TEAM_HOST_ARG)void import('./host-runtime').then(({startTeamRuntime})=>startTeamRuntime(process.argv[3]!,process.argv[4]!,JSON.parse(process.argv[5]??'{}'))).then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
else if(process.argv[2]===BACKGROUND_UPDATE_ARG)void import('./background-update').then(({backgroundUpdateMain})=>backgroundUpdateMain(process.argv.slice(3))).catch(()=>{});
else void import('./dispatch').then(({runCli})=>runCli(process.argv.slice(2))).then(code=>{process.exitCode=code;});
