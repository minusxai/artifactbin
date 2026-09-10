import {stat,realpath} from 'node:fs/promises';
import {relative,resolve} from 'node:path';
import {ARTIFACT_ID_PATTERN} from '@artifactbin/contracts';
import {CliError} from './commands';
import {confinedPath} from './journal';
import {isMissing} from './files';
export type Reference=({kind:'path';path:string}|{kind:'id';id:string})&{version?:number;notices:string[]};
export async function resolveReference(input:string,options:{root:string;cwd?:string;server?:string;writable?:boolean}):Promise<Reference>{
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
  if(url.origin!==new URL(options.server??'https://artifactbin.dev').origin||url.username||url.password||url.search||url.hash)throw new CliError('wrong_server','The artifact URL must belong to the selected server origin.','Use --server URL to select that server.');
  const match=url.pathname.match(/^\/(?:a|@[^/]+)\/([A-Za-z0-9]{6,12})(?:-[^/]+)?\/?$/);
  if(!match)throw new CliError('invalid_reference','Use an artifact URL with an artifact id.');
  id=match[1];
 }
 if(!ARTIFACT_ID_PATTERN.test(id))throw new CliError('invalid_reference',`Cannot resolve ${input}.`,'Use an existing local file, artifact id or artifact URL, optionally followed by @version.');
 return{kind:'id',id,...(version?{version}:{}),notices:[]};
}
