import type {HtmlJson,PageResolverFieldCall} from '@artifactbin/contracts';
import type {MutationContext,MutationProgram,RegisteredMutationPlan,RegisteredMutationOutcome} from './contracts';
import {validateMutationProgram} from './model';
export function registeredMutationSchema(program:MutationProgram):string {
 validateMutationProgram(program);
 const fields=Object.entries(program.values).map(([name,spec])=>`${name}:${spec.type==='number'?'Float':spec.type==='boolean'?'Boolean':'String'}${spec.nullable?'':'!'}${Object.hasOwn(spec,'default')?` = ${JSON.stringify(spec.default)}`:''}`);
 return `${fields.length?`input Values {${fields.join(' ')}}`:''} type Outcome {requestId:String! outcome:String! revision:String affected:Int reset:[String!]!} type Mutation {run(requestId:String!${fields.length?',values:Values!':''}):Outcome!}`;
}
export function registeredMutationDescriptor(namespace:string,program:MutationProgram){
 if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(namespace))throw Error('invalid_mutation_descriptor');validateMutationProgram(program);
 const values=Object.entries(program.values).map(([name,spec])=>({name,type:spec.type,nullable:spec.nullable}));
 return {name:program.name,namespace,values,outcomePath:[namespace,'run'],reset:[...program.reset],document:`mutation RegisteredMutation($requestId:String!${values.length?`,$values:${namespace}__Values!`:''}) {${namespace} {run(requestId:$requestId${values.length?',values:$values':''}) {requestId outcome revision affected reset}}}`};
}
export function registeredMutationInvoker(context:MutationContext,plan:RegisteredMutationPlan,execute:(context:MutationContext,plan:RegisteredMutationPlan,input:unknown,signal:AbortSignal)=>Promise<RegisteredMutationOutcome>){
 return async(call:PageResolverFieldCall):Promise<HtmlJson>=>{
  if(call.operation!=='mutation'||call.field!=='run'||call.principal.tenant!==context.pageId||call.principal.subject!==context.subject||call.fileId!==context.backendId||call.version!==context.backendVersion)throw Error('registered_mutation_unavailable');
  const result=await execute(context,plan,{...call.args,values:call.args.values??{}},call.signal);call.reportOutcome?.(result.outcome);return {...result};
 };
}
