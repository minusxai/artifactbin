/** Operator setup is independent of client host profiles and credentials. */
import {writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {configDir} from './config';
import {privateDirectory} from './files';
import {teamSettings,type TeamOverrides} from './team-config';
export interface ServeOptions extends TeamOverrides {config?:string;home:string;cwd:string}
export async function prepareServe(options:ServeOptions):Promise<{config:string;overrides:TeamOverrides}>{
 const directory=resolve(options.cwd,options.directory??configDir(options.home)+'/server');
 const config=resolve(options.cwd,options.config??join(directory,'server.env'));
 if(!options.config){
  await privateDirectory(directory);
  const port=options.port??7445;
  const text=`APP__HOST=127.0.0.1\nAPP__PORT=${port}\nAPP__PUBLIC_BASE_URL=http://127.0.0.1:${port}\nAUTH__SECRET=${randomBytes(32).toString('hex')}\n`;
  try{await writeFile(config,text,{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
 }
 const overrides:TeamOverrides={...(options.directory?{directory}:{}),...(options.port!==undefined?{port:options.port}:{}),...(options.dbUrl?{dbUrl:options.dbUrl}:{})};
 await teamSettings(config,process.env,overrides);
 return {config,overrides};
}
