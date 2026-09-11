import {parseSharingEntries} from '../../utils/src/sharing';
import {enumArgument} from './arguments';
import {parseDocument as parseYaml, stringify, visit, isAlias} from 'yaml';
import {ARTIFACT_ID_PATTERN,type ShareEntry} from '@artifactbin/contracts';
import {CliError} from './commands';

export interface DocumentMetadata {
 shares?:ShareEntry[]; description?:string|null;colorMode?:'light'|'dark'|null;
 id?:string; title?:string|null; theme?:string|null; template?:string|null;
 visibility?:'private'|'unlisted'|'public';link?:'viewer'|'commenter'|'editor';folder?:string|null;
 edit_id?:string;head_version?:number;state?:string;version?:number;
}
export interface LocalDocument {metadata:DocumentMetadata;body:string}
export const identityFields=['id','edit_id','head_version','state','version'] as const;
export const metadataFields=['title','description','colorMode','theme','template','visibility','link','folder','shares'] as const;
export function parseDocument(source:string):LocalDocument {
 if(!/^---\r?\n/.test(source))return{metadata:{},body:source};
 const first=source.indexOf('\n')+1;
 const end=/^---(?:\r?\n|$)/gm;end.lastIndex=first;
 const match=end.exec(source);
 if(!match)throw new CliError('invalid_fence','The metadata fence has no closing --- line.');
 const yaml=parseYaml(source.slice(first,match.index),{uniqueKeys:true,strict:true});
 if(yaml.errors.length||yaml.warnings.length)throw new CliError('invalid_fence','Invalid YAML metadata fence.',undefined,[...yaml.errors,...yaml.warnings].map(x=>x.message));
 visit(yaml,(_,node)=>{if(isAlias(node)||node&&typeof node==='object'&&'anchor'in node&&node.anchor)throw new CliError('invalid_fence','Metadata must use literal values, without YAML aliases or anchors.');});
 const metadata=yaml.toJS({maxAliasCount:0})??{};
 if(metadata&&typeof metadata==='object'&&!Array.isArray(metadata)){
  for(const [key,choices] of Object.entries({visibility:['private','unlisted','public'],link:['viewer','commenter','editor'],colorMode:['light','dark']}))if(typeof metadata[key]==='string')metadata[key]=enumArgument(metadata[key],choices,key);
  if(metadata.shares!==undefined){try{metadata.shares=parseSharingEntries(metadata.shares);}catch(error){throw new CliError('invalid_fence_value',error instanceof Error?error.message:'Invalid shares');}}
 }
 validateMetadata(metadata);
 return {metadata,body:source.slice(match.index+match[0].length)};
}
export function validateMetadata(value:unknown):asserts value is DocumentMetadata {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new CliError('invalid_fence','Metadata must be a YAML mapping.');
 for(const [key,field] of Object.entries(value)){
  if(![...identityFields,...metadataFields].includes(key as never))throw new CliError('unknown_fence_key',`Unknown metadata key ${key}.`,`Use: ${[...metadataFields,...identityFields].join(', ')}.`);
  let valid=false;
  if(key==='shares'){try{valid=Array.isArray(field)&&!!parseSharingEntries(field);}catch{valid=false;}}
  else if(key==='colorMode')valid=field===null||field==='light'||field==='dark';
  else if(key==='id'||key==='folder')valid=key==='folder'&&field===null||typeof field==='string'&&ARTIFACT_ID_PATTERN.test(field);
  else if(key==='head_version'||key==='version')valid=typeof field==='number'&&Number.isSafeInteger(field)&&field>0;
  else if(key==='state')valid=typeof field==='string'&&/^[a-f0-9]{64}$/.test(field);
  else if(key==='edit_id')valid=typeof field==='string'&&/^[A-Za-z0-9_-]+$/.test(field);
  else if(key==='visibility')valid=['private','unlisted','public'].includes(field as string);
  else if(key==='link')valid=['viewer','commenter','editor'].includes(field as string);
  else valid=field===null||typeof field==='string';
  if(!valid)throw new CliError('invalid_fence_value',`Invalid value for metadata key ${key}.`);
 }
}
export function writeDocument(document:LocalDocument):string {
 validateMetadata(document.metadata);
 return `---\n${stringify(document.metadata,{lineWidth:0})}---\n${document.body}`;
}
