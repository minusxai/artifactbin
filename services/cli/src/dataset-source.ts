import {parseJsx,type JsxElement} from '../../app/lib/jsx';
import {parseDatasetDefinition} from '../../app/lib/datasets/definition';
import type {CatalogInput} from '../../app/lib/datasets/types';
import {resolveReference} from './reference';
import {extname,join,resolve} from 'node:path';
import {CliError} from './errors';
import {atomicWrite,readOptional} from './files';
import {confinedPath} from './journal';
import {parseResourceFile} from './resource-file';
import type {HttpClient} from './http';
import type {Workspace} from './workspace';

export const endLine=(text:string):string=>text.endsWith('\n')?text:text+'\n';
export function datasetRows(bytes:Buffer):Record<string,unknown>[]{
 let rows:unknown;try{rows=JSON.parse(bytes.toString());}catch{throw new CliError('invalid_response','Dataset content must be JSON rows.');}
 if(!Array.isArray(rows)||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new CliError('invalid_response','Dataset content must contain row objects.');
 return rows as Record<string,unknown>[];
}

interface DefinitionConnection {target:{host:string;port:number;database:string;username:string;ssl:boolean};secretId?:string;span:{start:number;end:number}}
function definitionRoot(source:string):JsxElement{
 const parsed=parseJsx(source);
 if(!parsed.ok)throw new CliError('invalid_definition','The dataset definition is not valid JSX.','Run afbin validate on the definition file.');
 const roots=parsed.nodes.filter(node=>node.type!=='text'||node.value.trim());
 if(roots.length!==1||roots[0].type!=='element'||roots[0].tag!=='Dataset')throw new CliError('invalid_definition','A dataset definition holds exactly one <Dataset> root.');
 return roots[0];
}
/** Read the inline connection without requiring its secret id, so a first push can still bind one. */
function datasetConnection(source:string):DefinitionConnection|undefined{
 const root=definitionRoot(source);
 const element=root.children.find((node):node is JsxElement=>node.type==='element'&&node.tag==='Connection');
 if(!element)return undefined;
 const read=(name:string)=>{const attribute=element.attributes.find(item=>item.name===name);if(attribute&&!attribute.value.static)throw new CliError('invalid_definition',`Connection.${name} must be a static value.`);return attribute?.value.static?attribute.value.json:undefined;};
 const text=(name:string)=>{const value=read(name);if(typeof value!=='string'||!value)throw new CliError('invalid_definition',`Connection.${name} must be a string.`);return value;};
 const port=read('port');if(typeof port!=='number'||!Number.isInteger(port))throw new CliError('invalid_definition','Connection.port must be an integer.');
 const ssl=read('ssl');if(typeof ssl!=='boolean')throw new CliError('invalid_definition','Connection.ssl must be true or false.');
 const secret=read('passwordSecretId');
 if(secret!==undefined&&typeof secret!=='string')throw new CliError('invalid_definition','Connection.passwordSecretId must be a string.');
 const existing=element.attributes.find(item=>item.name==='passwordSecretId');
 const last=element.attributes[element.attributes.length-1];
 const span=existing?{start:existing.start,end:existing.end}:{start:last?last.end:element.start+'<Connection'.length,end:last?last.end:element.start+'<Connection'.length};
 return {target:{host:text('host'),port,database:text('database'),username:text('username'),ssl},...(secret===undefined?{}:{secretId:secret}),span};
}
/** Reference the bound secret by id; the password itself never reaches this file. */
function withSecretId(source:string,connection:DefinitionConnection,secretId:string):string{
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(secretId))throw new CliError('invalid_response','The server returned an unusable secret id.');
 const attribute=`passwordSecretId="${secretId}"`;
 return source.slice(0,connection.span.start)+(connection.span.start===connection.span.end?' ':'')+attribute+source.slice(connection.span.end);
}

/**
 * Bind a connection password once. The value is read from the environment, sent to the
 * secret door and forgotten; only the returned id is written anywhere, and it is written
 * into the definition the same push publishes.
 */
export async function bindDatasetSecret(workspace:Workspace,paths:string[],client:HttpClient,env:NodeJS.ProcessEnv,variable:string,dryRun=false):Promise<Record<string,unknown>>{
 if(paths.length!==1)throw new CliError('invalid_arguments','--secret-env binds the password of one dataset connection.','Push that dataset YAML on its own.');
 const path=await confinedPath(workspace.root,resolve(workspace.cwd,paths[0]));
 const bytes=await readOptional(path);
 if(!bytes)throw new CliError('missing_file',`Missing ${paths[0]}.`);
 if(!/\.ya?ml$/i.test(path))throw new CliError('invalid_arguments','--secret-env applies to a dataset YAML whose source is a <Dataset> definition.');
 const resource=parseResourceFile(bytes.toString());
 if(resource.type!=='dataset'||!resource.source)throw new CliError('invalid_arguments','--secret-env applies to a dataset YAML whose source is a <Dataset> definition.');
 if(extname(resource.source).toLowerCase()!=='.jsx')throw new CliError('invalid_arguments','Only a <Dataset> definition holds a connection.','A dataset of stored rows has no password.');
 const definitionPath=await confinedPath(workspace.root,resolve(workspace.root,join(path,'..'),resource.source));
 const definition=await readOptional(definitionPath);
 if(!definition)throw new CliError('missing_source',`Cannot read source ${resource.source}.`);
 const connection=datasetConnection(definition.toString());
 if(!connection)throw new CliError('no_connection','The definition declares no <Connection> to bind a password to.','Add the connection first, or publish without --secret-env.');
 const value=env[variable];
 if(typeof value!=='string'||!value)throw new CliError('missing_secret',`The environment variable ${variable} is empty.`,'Export the password in the environment; it is never read from a file or an argument.');
 // A dry run creates no credential, so an unbound definition cannot be validated against the server either.
 if(dryRun)return connection.secretId?{secret:{source:variable,status:'bound',id:connection.secretId},source:resource.source}
  :{dry_run:true,secret:{source:variable,status:'would_create'},connection:connection.target,operations:[{path:paths[0],status:'skipped',reason:'secret_binding_required'}]};
 const created=await client.request<{secret?:{id?:unknown}}>('/secrets','POST',{value,connection:connection.target,...(resource.id?{datasetId:resource.id}:{})});
 const id=created.secret?.id;
 if(typeof id!=='string'||!id)throw new CliError('invalid_response','The secret door did not return a secret id.');
 await atomicWrite(definitionPath,Buffer.from(withSecretId(definition.toString(),connection,id)));
 return{secret:{id,source:variable},source:resource.source};
}

/** The local definition a dataset YAML names, when the target is a local dataset at all. */
export async function localDefinition(workspace:Workspace,input:string,server:string):Promise<{definition:CatalogInput;id?:string;path:string}|undefined>{
 const ref=await resolveReference(input,{root:workspace.root,cwd:workspace.cwd,server});
 if(ref.kind!=='path'||ref.version!==undefined||!/\.ya?ml$/i.test(ref.path))return undefined;
 const bytes=await readOptional(join(workspace.root,ref.path));if(!bytes)return undefined;
 const resource=parseResourceFile(bytes.toString());
 if(resource.type!=='dataset'||!resource.source||extname(resource.source).toLowerCase()!=='.jsx')return undefined;
 const source=await readOptional(await confinedPath(workspace.root,resolve(workspace.root,join(ref.path,'..'),resource.source)));
 if(!source)throw new CliError('missing_source',`Cannot read source ${resource.source}.`);
 let definition:CatalogInput;
 try{definition=parseDatasetDefinition(source.toString());}
 catch(error){throw new CliError('invalid_definition',error instanceof Error?error.message:'The dataset definition is invalid.','A connected definition needs its bound passwordSecretId; run afbin push --secret-env NAME once.');}
 return{definition,...(resource.id?{id:resource.id}:{}),path:ref.path};
}
