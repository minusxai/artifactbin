import {BACKGROUND_UPDATE_ARG,backgroundUpdateMain} from './background-update';
import {runCli} from './dispatch';
if(process.argv[2]===BACKGROUND_UPDATE_ARG)void backgroundUpdateMain(process.argv.slice(3)).catch(()=>{});
else void runCli(process.argv.slice(2)).then(code=>{process.exitCode=code;});
