import type {Scalar} from '@artifactbin/contracts';
import {CliError,type ParsedCommand} from './commands';
import {queryParameters} from './local-query';
import {artifactReference} from './read-commands';
import {recoverableOperation} from './recoverable-operation';
import type {Workspace,Snapshot} from './workspace';
import type {HttpClient} from './http';

interface MutationParameter {name:string;type?:string;required?:boolean;default?:Scalar}
interface MutationDeclaration {name:string;params?:MutationParameter[];target?:string}

/** A declared mutation is the document's own statement; the caller supplies bound values, never SQL. */
function declaredMutation(head:Snapshot,name:string,values:Record<string,Scalar>):Record<string,unknown>{
 const declared=(Array.isArray(head.mutations)?head.mutations:[]) as MutationDeclaration[];
 const selected=declared.find(item=>item&&item.name===name);
 if(!selected)throw new CliError('unknown_mutation',`${head.id} does not declare the mutation ${name}.`,declared.length?`Declared mutations: ${declared.map(item=>item.name).join(', ')}.`:'This resource declares no mutations; write dataset rows with --input SQL.');
 const params=selected.params??[];
 for(const key of Object.keys(values))if(!params.some(param=>param.name===key))throw new CliError('unknown_parameter',`${name} does not declare the parameter ${key}.`,`Declared parameters: ${params.map(param=>param.name).join(', ')||'none'}.`);
 const missing=params.filter(param=>param.required!==false&&param.default===undefined&&!Object.hasOwn(values,param.name)).map(param=>param.name);
 if(missing.length)throw new CliError('missing_parameter',`${name} requires ${missing.join(', ')}.`,'Supply each value with --param name=value.');
 for(const param of params){
  if(!Object.hasOwn(values,param.name)||param.type===undefined)continue;
  const value=values[param.name];
  const valid=param.type==='number'?typeof value==='number':param.type==='boolean'?typeof value==='boolean':['string','date'].includes(param.type)?typeof value==='string':true;
  if(!valid)throw new CliError('invalid_parameter',`Parameter ${param.name} must be a ${param.type}.`,'Values are bound by declared type, never interpolated.');
 }
 return{mutation:name,target:selected.target??head.id,parameters:params.map(param=>param.name)};
}
function datasetMutation(head:Snapshot,sql:string):Record<string,unknown>{
 if(head.format!=='dataset')throw new CliError('invalid_query',`${head.id} is a ${head.format} artifact; SQL input writes dataset rows.`,'Select one of its declared mutations with --name instead.');
 return{mutation:'sql',target:head.id,statement:sql.trim().split(/\s+/)[0].toLowerCase()};
}

/** One frozen domain operation survives a transport failure through the shared journal. */
export async function queryMutation(workspace:Workspace,parsed:ParsedCommand,sql:string|undefined,client:HttpClient){
 const {flags}=parsed;
 const name=typeof flags.name==='string'?flags.name:undefined;
 if(!name&&!sql?.trim())throw new CliError('invalid_query','A mutation needs SQL supplied with --input, or a declared mutation selected with --name.');
 const values=queryParameters(flags.param as string[]|undefined);
 const ref=await artifactReference(workspace,parsed.positionals[0],client.connection.server,true);
 if(ref.version!==undefined)throw new CliError('historical_mutation','A mutation writes the current resource.','Pull the historical version and push it conditionally instead.');
 const plan=(head:Snapshot)=>{
  if(head.id!==ref.id||typeof head.state!=='string')throw new CliError('invalid_response','The server did not return a complete artifact snapshot.');
  return name?declaredMutation(head,name,values):datasetMutation(head,sql!);
 };
 if(flags['dry-run']){
  const head=await client.request<Snapshot>(`/artifacts/${ref.id}`);
  return{dry_run:true,id:ref.id,...plan(head),values,applied:false};
 }
 return recoverableOperation(workspace,client,{
  path:`/artifacts/${ref.id}/mutate`,method:'POST',
  identity:{id:ref.id,...(name?{name}:{sql}),values},
  body:{...(name?{name}:{sql}),values},
  prepare:async()=>{
   const head=await client.request<Snapshot>(`/artifacts/${ref.id}`);
   plan(head);
   if(!(head.capabilities as {mutation_receipts?:boolean}|undefined)?.mutation_receipts)throw new CliError('unsupported_server','This server does not support recoverable mutations.');
   return{body:name?{name,values}:{sql,values,expectedState:head.state}};
  },
 });
}
