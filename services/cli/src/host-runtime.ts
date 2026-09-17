/** Load the packaged foreground host without importing server configuration into the CLI. */
import {getAsset,isSea} from 'node:sea';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {foregroundProcess} from './foreground-process';
import {configDir,servicePackageUrl} from './config';
import {ensureNativePackage,type NativePackage} from './native-package';
import {CLI_VERSION} from './version';
import {TEAM_HOST_ARG} from './entry-args';
import {prepareServe,type ServeOptions} from './serve-config';
import type {TeamOverrides} from './team-config';
export async function hostRuntime(home:string,env?:NodeJS.ProcessEnv):Promise<string>{
 if(!isSea())return join(dirname(fileURLToPath(import.meta.url)),'runtime');
 const manifest=JSON.parse(Buffer.from(getAsset('host-runtime-manifest')).toString()) as NativePackage;
 const root=await ensureNativePackage({...manifest,url:servicePackageUrl(manifest.url,env)},{root:join(configDir(home,env),'services/runtime',CLI_VERSION),kind:'runtime'});
 return join(root,'node_modules/@artifactbin/host-runtime');
}
export async function startTeamRuntime(config:string,assets:string,overrides:TeamOverrides={}):Promise<void>{
 const bootstrap=join(assets,'bootstrap.cjs');
 const host=createRequire(bootstrap)(bootstrap) as {team:(config:string,assets:string,overrides:TeamOverrides)=>Promise<void>};
 await host.team(config,assets,overrides);
}
export async function serveTeam(options:ServeOptions):Promise<number>{
 const {config,overrides}=await prepareServe(options);
 const assets=await hostRuntime(options.home);
 const prefix=isSea()?[]:[join(dirname(fileURLToPath(import.meta.url)),'afbin.mjs')];
 return foregroundProcess(process.execPath,[...prefix,TEAM_HOST_ARG,config,assets,JSON.stringify(overrides)]);
}
