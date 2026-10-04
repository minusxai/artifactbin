/** Load the packaged foreground host without importing server configuration into the CLI. */
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {foregroundProcess} from './foreground-process';
import {TEAM_HOST_ARG} from './entry-args';
import {prepareServe,type ServeOptions} from './serve-config';
import type {TeamOverrides} from './team-config';
export async function hostRuntime():Promise<string>{
 return join(dirname(fileURLToPath(import.meta.url)),'runtime');
}
export async function startTeamRuntime(config:string,assets:string,overrides:TeamOverrides={}):Promise<void>{
 const bootstrap=join(assets,'bootstrap.cjs');
 const host=createRequire(bootstrap)(bootstrap) as {team:(config:string,assets:string,overrides:TeamOverrides)=>Promise<void>};
 await host.team(config,assets,overrides);
}
export async function serveTeam(options:ServeOptions):Promise<number>{
 const {config,overrides}=await prepareServe(options);
 const assets=await hostRuntime();
 const prefix=[join(dirname(fileURLToPath(import.meta.url)),'afbin.mjs')];
 return foregroundProcess(process.execPath,[...prefix,TEAM_HOST_ARG,config,assets,JSON.stringify(overrides)]);
}
