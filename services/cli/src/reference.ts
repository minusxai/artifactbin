import {artifactIdFromPath} from '../../utils/src/artifact-reference';
import {stat,realpath} from 'node:fs/promises';
import {relative,resolve} from 'node:path';
import {ARTIFACT_ID_PATTERN,normalizeOrigin} from '@artifactbin/contracts';
import {CliError} from './commands';
import {confinedPath} from './journal';
import {isMissing} from './files';
import {DEFAULT_SERVER} from './config';
export type Reference=({kind:'path';path:string}|{kind:'id';id:string})&{version?:number;notices:string[]};
export async function resolveReference(input:string,options:{root:string;cwd?:string;server?:string;/** Verified alias origins of `server`; a URL at one of them names the same server. */aliases?:string[];writable?:boolean}):Promise<Reference>{
 const root=await realpath(options.root);
 const exists=async(value:string)=>{try{return(await stat(resolve(options.cwd??options.root,value))).isFile();}catch(error){if(isMissing(error)||(error as NodeJS.ErrnoException).code==='ENOTDIR')return false;throw error;}};
 const suffix=input.match(/^(.+)@(\d+)$/);
 if(await exists(input)){
  const full=await confinedPath(options.root,resolve(options.cwd??options.root,input));
  return{kind:'path',path:relative(root,full),notices:suffix?[`Existing path ${input} takes precedence over ${suffix[1]} at version ${suffix[2]}. Use the explicit artifact id@${suffix[2]} to select that version.`]:[]};
 }
 const value=suffix?suffix[1]:input;
 const version=suffix?Number(suffix[2]):undefined;
 if(version!==undefined&&(!Number.isSafeInteger(version)||version<1))throw new CliError('invalid_version','A version must be a positive integer.');
 if(version!==undefined&&options.writable)throw new CliError('version_not_writable','A version suffix is not allowed for push, delete or comment.','Use the head reference.');
 if(await exists(value))return{kind:'path',path:relative(root,await confinedPath(options.root,resolve(options.cwd??options.root,value))),...(version?{version}:{}),notices:[]};
 let id=value;
 if(/^https?:\/\//.test(value)){
  let url:URL;try{url=new URL(value);}catch{throw new CliError('invalid_reference','Invalid artifact URL.');}
  // ONE SERVER, SEVERAL ADDRESSES. The selected server's verified aliases name the same
  // deployment, so a link copied from either hostname resolves here — but only to its
  // artifact id: the URL never selects where the request or the credential goes.
  const selected=new URL(options.server??DEFAULT_SERVER).origin;
  const addresses=[selected,...(options.aliases??[]).map(alias=>normalizeOrigin(alias)).filter((alias):alias is string=>!!alias)];
  // Userinfo is refused whatever the origin: an address that carries credentials is not an artifact URL.
  if(url.username||url.password)throw new CliError('wrong_server',`The artifact URL carries credentials in its address; the selected server is ${selected}.`,`Use the plain URL or the artifact id, and --server <origin> to select a different server.`);
  if(!addresses.includes(url.origin))throw new CliError('wrong_server',`The artifact URL at ${url.origin} does not belong to ${selected}, the selected server.`,`Pass --server ${url.origin} to select that server, or use a URL at ${selected}.`);
  const parsedId=artifactIdFromPath(url.pathname);
  if(!parsedId)throw new CliError('invalid_reference','Use an artifact URL with an artifact id.');
  id=parsedId;
 }
 if(!ARTIFACT_ID_PATTERN.test(id))throw new CliError('invalid_reference',`Cannot resolve ${input}.`,'Use an existing local file, artifact id or artifact URL, optionally followed by @version.');
 return{kind:'id',id,...(version?{version}:{}),notices:[]};
}
