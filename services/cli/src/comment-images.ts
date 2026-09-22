import {mkdir,lstat} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {COMMENT_IMAGE_LIMITS} from '../../contracts/src/comment-image';
import {atomicWrite,isMissing} from './files';
import {confinedPath} from './journal';
import {CliError} from './errors';
import type {HttpClient} from './http';
import type {Workspace} from './workspace';

/** Read-only remote retrieval, exclusive private local output; never follow metadata URLs. */
export async function downloadCommentImage(workspace:Workspace,client:HttpClient,artifactId:string,imageId:string,output:string,variant='preview'){
 const path=await confinedPath(workspace.root,resolve(workspace.cwd,output)).catch(()=>{throw new CliError('invalid_output','Comment images must be saved inside the workspace.');});
 try{await lstat(path);throw new CliError('file_exists','The output file already exists. Choose another --output path.');}catch(error){if(!isMissing(error))throw error;}
 const {bytes,contentType}=await client.content(`/artifacts/${artifactId}/comment-images/${imageId}?variant=${variant}`);
 if(contentType.split(';')[0]?.trim().toLowerCase()!=='image/webp'||bytes.length<12||bytes.subarray(0,4).toString()!=='RIFF'||bytes.subarray(8,12).toString()!=='WEBP'||bytes.length>COMMENT_IMAGE_LIMITS.bytes)
  throw new CliError('invalid_image_response','The server did not return a supported comment image.');
 await mkdir(dirname(path),{recursive:true,mode:0o700});
 await atomicWrite(path,bytes,{exclusive:true,mode:0o600});
 return {artifact_id:artifactId,image_id:imageId,variant,path,content_type:'image/webp',bytes:bytes.length,next:'Open this local file with your image viewing tool and visually inspect it before answering the comment. If your model cannot view images, report that limitation; do not infer the pixels from surrounding text.'};
}
