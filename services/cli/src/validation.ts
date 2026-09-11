import {stat} from 'node:fs/promises';
import {join} from 'node:path';
import {validateMarkupStructure} from '../../app/lib/story/local-validation';
import {formatMarkupSource} from '../../app/lib/story/format-source';
import {STORY_THEME_NAMES,STORY_TEMPLATE_NAMES} from '../../app/lib/validation/atlas-schemas';
import {inspectWorkspace,type Workspace} from './workspace';
import {assetInput,planDependencies,substituteDependencies} from './dependencies';
import {atomicWrite,digest,readOptional} from './files';
import {CliError} from './commands';
import {resourceContent} from './resource-file';
export interface Diagnostic {code:string;message:string;fix?:string;start?:number;end?:number;severity?:'error'|'notice'}
export async function validateFiles(workspace:Workspace,paths?:string[],fix=false,options:{skipMissingTracked?:boolean}={}){
 const files:Array<{path:string;valid:boolean;fixed:boolean;diagnostics:Diagnostic[]}>=[];
 for(const file of await inspectWorkspace(workspace,paths)){
  if(options.skipMissingTracked&&!file.bytes&&file.tracked)continue;
  const diagnostics:Diagnostic[]=[];let fixed=false;
  try{
   if(!file.bytes)throw new CliError('missing_file',`Missing file: ${file.path}.`,'Restore the file or use afbin delete to delete its remote artifact explicitly.');
   if(file.document){
    const {metadata,body}=file.document;
    if(metadata.theme&&!STORY_THEME_NAMES.includes(metadata.theme as never))throw new CliError('unknown_theme',`Unknown theme ${metadata.theme}.`,`Choose ${STORY_THEME_NAMES.join(', ')}.`);
    if(metadata.template&&!STORY_TEMPLATE_NAMES.includes(metadata.template as never))throw new CliError('unknown_template',`Unknown template ${metadata.template}.`,`Choose ${STORY_TEMPLATE_NAMES.join(', ')}.`);
    const dependencies=await planDependencies(body,file.path,workspace.root);
    const checked=validateMarkupStructure(substituteDependencies(body,dependencies));
    diagnostics.push(...checked.errors.map(error=>({code:'invalid_markup',message:error.message,start:error.start,end:error.end})));
    if(fix&&!diagnostics.length){
     const formatted=formatMarkupSource(body);
     const original=file.bytes.toString();
     const next=original.slice(0,original.length-body.length)+formatted;
     if(next!==original){
      const path=join(workspace.root,file.path);const current=await readOptional(path);
      if(!current||digest(current)!==digest(file.bytes))throw new CliError('local_changed',`${file.path} changed during validation; it was not overwritten.`);
      await atomicWrite(path,next,{mode:(await stat(path)).mode&0o777});fixed=true;
     }
    }
   }else if(file.resource){
    const content=await resourceContent(file.resource,file.path,workspace.root);
    if(typeof content.markup==='string')diagnostics.push(...validateMarkupStructure(content.markup).errors.map(error=>({code:'invalid_markup',message:error.message,start:error.start,end:error.end})));
   }else assetInput(file.path,file.bytes);
  }catch(error){diagnostics.push({code:error instanceof CliError?error.code:'validation_failed',message:error instanceof Error?error.message:String(error),...(error instanceof CliError&&error.fix?{fix:error.fix}:{})});}
  files.push({path:file.path,valid:!diagnostics.some(x=>x.severity!=='notice'),fixed,diagnostics});
 }
 return{valid:files.every(file=>file.valid),files};
}
