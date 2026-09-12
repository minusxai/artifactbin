import {extname} from 'node:path';
import {CliError} from './errors';
import {digest,readOptional} from './files';
import {confinedPath} from './journal';
import {resolveReference} from './reference';
import {parseDocument} from './document';
import {parseResourceFile} from './resource-file';
import {serverRenderer} from './export';
import type {Workspace} from './workspace';

/**
 * `open` shows the PUBLISHED view and nothing else. There is no local draft preview — that
 * needs the document runtime the CLI does not ship — and a draft is never uploaded to make
 * one, so an unpublished file is refused rather than published on the way to being seen.
 * The view URL is derivable from the identity a local file already carries, so opening a
 * tracked file costs no request and no credentials.
 */
interface OpenOptions {server:string;noBrowser?:boolean;json?:boolean;launch?:(url:string)=>Promise<void>}
const DRAFT_FIX='Publish it with afbin push, then open it; drafts are never uploaded for preview.';

export async function openResources(workspace:Workspace,refs:string[],options:OpenOptions):Promise<{operations:Record<string,unknown>[]}>{
 const renderer=serverRenderer(options.server);
 const targets=[];
 for(const input of refs){
  const ref=await resolveReference(input,{root:workspace.root,cwd:workspace.cwd,server:options.server});
  if(ref.version!==undefined)throw new CliError('unsupported_version_export',`${input} names version ${ref.version}; the viewer shows the current published document.`,'Open the head, or use afbin pull ref@version to read that content.');
  targets.push({ref:input,id:ref.kind==='id'?ref.id:await publishedIdentity(workspace,ref.path)});
 }
 // `--json` suppresses the launch; only the URL is the answer a caller wanted parsed.
 const launch=!options.noBrowser&&!options.json;
 const operations:Record<string,unknown>[]=[];
 for(const target of targets){
  const url=renderer.viewUrl(target.id);
  let opened=false;let failure:string|undefined;
  if(launch){
   try{await (options.launch??(async()=>{throw new CliError('browser_unavailable','No browser launcher is available.','Use --no-browser and open the printed URL.');}))(url);opened=true;}
   catch(error){failure=error instanceof Error?error.message:String(error);}
  }
  operations.push({ref:target.ref,id:target.id,url,browser:launch?opened?'launched':'unavailable':'suppressed',...(failure?{reason:failure}:{})});
 }
 return {operations};
}

/** A local file opens by the identity it carries; a changed tracked file is a draft again. */
async function publishedIdentity(workspace:Workspace,path:string):Promise<string>{
 const bytes=await readOptional(await confinedPath(workspace.root,path));
 if(!bytes)throw new CliError('missing_file',`Missing ${path}.`);
 const extension=extname(path).toLowerCase();
 const carried=extension==='.jsx'?parseDocument(bytes.toString()).metadata.id
  :['.yaml','.yml'].includes(extension)?parseResourceFile(bytes.toString()).id:undefined;
 const tracked=workspace.tracking?.files[path];
 if(tracked&&digest(bytes)!==tracked.file)throw new CliError('unpublished_draft',`${path} has local changes that are not published.`,DRAFT_FIX);
 const id=carried??tracked?.id;
 if(!id)throw new CliError('unpublished_draft',`${path} is not a published artifact.`,DRAFT_FIX);
 if(tracked&&carried&&tracked.id!==carried)throw new CliError('identity_mismatch',`${path} carries an id that disagrees with its tracking.`,'Restore the tracked identity, or pull the artifact into a fresh path.');
 return id;
}
