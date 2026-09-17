/** Foreground entry: install operator configuration before importing eager application modules. */
import {createServer} from 'node:http';
import {mkdir,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {getRequestListener} from '@hono/node-server';
import {teamSettings,type TeamOverrides} from './team-config';
import {withLock} from './state';

export async function startTeamHost(configFile:string,assets:string,overrides:TeamOverrides={}):Promise<void>{
 const settings=await teamSettings(configFile,process.env,overrides),runtime=resolve(assets),data=join(settings.directory,'data');
 await mkdir(data,{recursive:true,mode:0o700});
 for(const path of [data,join(data,'pglite'),join(data,'objects')]){
  try{if((await lstat(path)).isSymbolicLink())throw new Error('Team storage must use its own directory, not a symlink.');}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 }
 await withLock(settings.directory,'@team-owner',async()=>{
  process.chdir(runtime);
  for(const key of Object.keys(process.env))if(!(key in settings.env))delete process.env[key];
  Object.assign(process.env,settings.env);
  // Intentional process-composition import: app config captures the installed environment eagerly.
  const {createTeamApplication}=await import('./team-application');
  const host=await createTeamApplication(settings.env,runtime),server=createServer(getRequestListener(host.fetch));
  let stop!:()=>void;const stopped=new Promise<void>(resolve=>{stop=resolve;});
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  try{
   await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(settings.port,settings.host,()=>{server.off('error',reject);resolve();});});
   process.stdout.write(`Team server listening on ${settings.host}:${settings.port}; public URL ${settings.origin}\n`);
   await stopped;
  }finally{
   // Terminal signals can reach both supervisor and child; repeated delivery only resolves stop again.
   try{await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});}
   finally{try{await host.close();}finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}}
  }
 },{waitMs:0,reentrant:false},{ARTIFACTBIN_HOME:data});
}
