/** Operator setup is independent of client host profiles and credentials. */
import {writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {configDir} from './config';
import {privateDirectory} from './files';
import {teamSettings,type TeamOverrides} from './team-config';
export interface ServeOptions extends TeamOverrides {config?:string;ownerEmail?:string;home:string;cwd:string}
export async function prepareServe(options:ServeOptions):Promise<{config:string;overrides:TeamOverrides}>{
 if(options.config&&options.ownerEmail!==undefined)throw new Error('Use APP__DEPLOYMENT_OWNER_EMAIL in the settings file; --owner-email cannot be combined with --config.');
 const owner=options.ownerEmail?.trim().toLowerCase();
 if(options.ownerEmail!==undefined&&(!owner||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner)))throw new Error('--owner-email requires a valid email address.');
 const directory=resolve(options.cwd,options.directory??configDir(options.home)+'/server');
 const config=resolve(options.cwd,options.config??join(directory,'server.env'));
 if(!options.config){
  await privateDirectory(directory);
  const port=options.port??7445;
  // The app at an lvh.me name (127.0.0.1 in public DNS), so it is same site with the documents' own
  // origins under lvh.me (team-config teamPagesHost) and the pages cookie reaches their frames.
  const text=`APP__HOST=127.0.0.1\nAPP__PORT=${port}\nAPP__PUBLIC_BASE_URL=http://app.lvh.me:${port}\nAPP__DEPLOYMENT_MODE=company\nAPP__DEPLOYMENT_OWNER_EMAIL=${owner??''}\nAUTH__SECRET=${randomBytes(32).toString('hex')}\n`;
  try{await writeFile(config,text,{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
 }
 const overrides:TeamOverrides={...(options.directory?{directory}:{}),...(options.port!==undefined?{port:options.port}:{}),...(options.dbUrl?{dbUrl:options.dbUrl}:{})};
 try{
  const settings=await teamSettings(config,process.env,overrides);
  if(owner&&settings.env.APP__DEPLOYMENT_OWNER_EMAIL?.trim().toLowerCase()!==owner)throw new Error(`APP__DEPLOYMENT_OWNER_EMAIL in ${config} differs from --owner-email. Existing settings are preserved; edit the file deliberately and retry with afbin serve --config ${JSON.stringify(config)}.`);
 }catch(error){
  if(error instanceof Error&&error.message==='Company hosting requires APP__DEPLOYMENT_OWNER_EMAIL.'){
   // Inspect no secret values; naming the operator file gives both first setup and a later retry a repair path.
   throw new Error(`Company hosting requires APP__DEPLOYMENT_OWNER_EMAIL in ${config}. Set it to your owner's email, then retry: afbin serve --config ${JSON.stringify(config)}${options.directory?` --dir ${JSON.stringify(directory)}`:''}. For a new directory, use afbin serve --dir <new-directory> --owner-email <owner-email>.`);
  }
  throw error;
 }
 return {config,overrides};
}
