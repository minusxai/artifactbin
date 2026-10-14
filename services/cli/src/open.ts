import {extname} from 'node:path';
import {CliError} from './errors';
import {digest,readOptional} from './files';
import {confinedPath} from './journal';
import {resolveReference} from './reference';
import {localIdentities} from './identities';
import {parseDocument} from './document';
import {parseResourceFile} from './resource-file';
import {serverRenderer} from './export';
import type {Workspace} from './workspace';

/** Open the published view. Local drafts use the separate foreground preview session. */
interface OpenOptions {server:string;/** Verified other addresses of `server`. */aliases?:readonly string[];json?:boolean;launch?:(url:string)=>Promise<void>}
const DRAFT_FIX='Use afbin preview <path> for local edits, or publish with afbin push before opening the published view.';

export async function openResources(workspace:Workspace,refs:string[],options:OpenOptions):Promise<{operations:Record<string,unknown>[]}>{
 const renderer=serverRenderer(options.server);
 const targets=[];
 for(const input of refs){
  const ref=await resolveReference(input,{root:workspace.root,cwd:workspace.cwd,server:options.server,aliases:[...options.aliases??[]]});
  if(ref.version!==undefined)throw new CliError('unsupported_version_export',`${input} names version ${ref.version}; the viewer shows the current published document.`,'Open the head, or use afbin pull ref@version to read that content.');
  // A bare id that names an unpublished local draft is that draft, not a page on the server.
  const draft=ref.kind==='id'&&!/^https?:\/\//i.test(input)&&!Object.values(workspace.tracking?.files??{}).some(file=>file.id===ref.id)?(await localIdentities(workspace))[ref.id]:undefined;
  targets.push({ref:input,id:ref.kind==='path'?await publishedIdentity(workspace,ref.path,input):draft!==undefined?await publishedIdentity(workspace,draft,draft):ref.id});
 }
 // `--json` suppresses the launch; only the URL is the answer a caller wanted parsed.
 const launch=!options.json;
 const operations:Record<string,unknown>[]=[];
 for(const target of targets){
  const url=renderer.viewUrl(target.id);
  let opened=false;let failure:string|undefined;
  if(launch){
   try{await (options.launch??(async()=>{throw new CliError('browser_unavailable','No browser launcher is available.','Open the printed URL.');}))(url);opened=true;}
   catch(error){failure=error instanceof Error?error.message:String(error);}
  }
  operations.push({ref:target.ref,id:target.id,url,browser:launch?opened?'launched':'unavailable':'suppressed',...(failure?{reason:failure}:{})});
 }
 return {operations};
}

/**
 * A local file opens by its PUBLISHED identity: its tracking, or the head a pulled copy carries. The id a
 * local workspace stamps into every registered draft is a local name with no page behind it, so a file
 * that was never published is refused instead of answered with a link that does not exist.
 */
async function publishedIdentity(workspace:Workspace,path:string,input:string):Promise<string>{
 const bytes=await readOptional(await confinedPath(workspace.root,path));
 if(!bytes)throw new CliError('missing_file',`Missing ${path}.`);
 const extension=extname(path).toLowerCase();
 const metadata=extension==='.jsx'?parseDocument(bytes.toString()).metadata
  :['.yaml','.yml'].includes(extension)?parseResourceFile(bytes.toString()):undefined;
 const carried=metadata?.id;
 const tracked=workspace.tracking?.files[path];
 if(tracked&&digest(bytes)!==tracked.file)throw new CliError('unpublished_draft',`${path} has local changes that are not published.`,DRAFT_FIX);
 if(!tracked&&(!carried||metadata?.head_version===undefined))throw new CliError('unpublished_draft',`${path} has never been published${carried?`; ${carried} is its local identity, not a published page`:''}.`,`Preview it locally with afbin preview ${input}, or publish it with afbin push ${input}.`);
 const id=tracked?.id??carried!;
 if(tracked&&carried&&tracked.id!==carried)throw new CliError('identity_mismatch',`${path} carries an id that disagrees with its tracking.`,'Restore the tracked identity, or pull the artifact into a fresh path.');
 return id;
}
