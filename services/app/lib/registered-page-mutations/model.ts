import {createHash} from 'node:crypto';
import type {Scalar} from '@artifactbin/contracts';
import type {MutationContext,MutationProgram,RegisteredMutationPlan,RegisteredMutationPorts,RegisteredMutationOutcome} from './contracts';
const name=(v:string)=>/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(v);
const scalar=(v:unknown):v is Scalar=>v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v);
export function validateMutationProgram(program:MutationProgram):void {
 if(Object.keys(program).some(key=>!['name','kind','sql','target','values','builtins','expectedAffected','reset','registration'].includes(key)))throw Error('unsupported_registered_mutation');
 if(!name(program.name)||!['insert','delete'].includes(program.kind)||program.expectedAffected!==1||!program.sql||Buffer.byteLength(program.sql)>64000||!program.target.datasetId||!name(program.target.schema)||!name(program.target.table)||Object.keys(program.values).length>200||program.reset.some(v=>!Object.hasOwn(program.values,v)))throw Error('unsupported_registered_mutation');
 const params=new Set<string>();
 for(const [key,value]of Object.entries(program.values)){if(!name(key)||!name(value.parameter)||!['string','number','boolean'].includes(value.type)||typeof value.nullable!=='boolean'||Object.hasOwn(value,'default')&&(!scalar(value.default)||value.default!==null&&typeof value.default!==value.type||value.default===null&&!value.nullable)||params.has(value.parameter))throw Error('unsupported_registered_mutation');params.add(value.parameter);}
 for(const builtin of program.builtins){if(!['_me.id','_now','_tz'].includes(builtin.name)||!name(builtin.parameter)||params.has(builtin.parameter))throw Error('unsupported_registered_mutation');params.add(builtin.parameter);}
}
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function createRegisteredMutationService(ports:RegisteredMutationPorts){return async(context:MutationContext,plan:RegisteredMutationPlan,input:unknown,signal:AbortSignal):Promise<RegisteredMutationOutcome>=>{
 signal.throwIfAborted();validateMutationProgram(plan);
 if(Object.entries(plan.registration).some(([key,value])=>context[key as keyof MutationContext]!==value))throw Error('registered_mutation_changed');
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['requestId','values'].includes(key)))throw Error('invalid_registered_mutation');
 const request=input as {requestId:unknown;values:unknown};
 if(typeof request.requestId!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(request.requestId)||!request.values||typeof request.values!=='object'||Array.isArray(request.values))throw Error('invalid_registered_mutation');
 const values=request.values as Record<string,unknown>,canonical:Record<string,Scalar>={};
 if(Object.keys(values).some(key=>!Object.hasOwn(plan.values,key)))throw Error('invalid_registered_mutation');
 for(const key of Object.keys(plan.values).sort()){const spec=plan.values[key]!,value=Object.hasOwn(values,key)?values[key]:spec.default;if(!scalar(value)||value===null&&!spec.nullable||value!==null&&typeof value!==spec.type)throw Error('invalid_registered_mutation');canonical[key]=value;}
 await ports.authorize(context,plan,signal);
 const identity=[context.callerKey,context.subject,plan.registration,plan.name],key=hash([identity,request.requestId]),fingerprint=hash([identity,canonical]);
 return ports.durable(context,key,fingerprint,async receipt=>{
  signal.throwIfAborted();await ports.authorize(context,plan,signal);
  const platform=await ports.platform(context),params:Record<string,Scalar>={};
  for(const [key,spec]of Object.entries(plan.values))params[spec.parameter]=canonical[key]!;
  for(const builtin of plan.builtins){if(builtin.name==='_me.id'&&!platform.userId)return {requestId:request.requestId as string,outcome:'rejected',revision:null,affected:null,reset:[]};params[builtin.parameter]=builtin.name==='_me.id'?platform.userId:builtin.name==='_now'?platform.now:platform.tz;}
  const result=await ports.commit(context,plan,params,receipt,signal);
  if(result.outcome==='committed'&&(result.affected!==1||!result.revision))throw Error('invalid_committed_mutation_receipt');
  return {requestId:request.requestId as string,...result,reset:result.outcome==='committed'?[...plan.reset]:[]};
 });};}
