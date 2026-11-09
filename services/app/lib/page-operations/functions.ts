/**
 * PAGE FUNCTIONS — a backend file's default-export functions called by name over plain HTTP (lib/page-graphql
 * `pageFunction`, route `/api/artifacts/:id/fn/:name`), beside the page GraphQL. Pure: no I/O but the invoke port.
 *
 * Which functions a page offers, and who may call each:
 *  · a typeDefs-free file: the function names its default export had at publish, each with the role its `roles`
 *    export names (default anonymous: anyone who can read the page) — `functionManifest`, stored with the version;
 *  · a legacy file (typeDefs): its Query and Mutation fields, each guarded by its `@auth`, as GraphQL guards it.
 * A name two linked files both offer is ambiguous (409), never guessed. Roles mean "at least", decided by the same
 * `resolverFieldRefusal` GraphQL uses; the caller is the admitted reader, never anything in the input.
 *
 * Kind: a legacy field's kind is its root (Query reads, Mutation writes); a typeDefs-free function's is its method
 * (GET reads, POST may write). A read may run on an archived revision and from an opaque origin; a write may not, and
 * a GET never runs a Mutation field.
 */
import {getDirectiveValues} from 'graphql';
import {DATASET_ROLES,type DatasetRole,type HtmlJson,type HtmlJsonObject,type PageCaller,type PageResolverFieldCall} from '@artifactbin/contracts';
import {boundedBackendSchema} from './execution-policy';
import {resolverFieldRefusal} from './namespaces';
import {FIELD_ERROR_CODE,PAGE_OPERATION_RESULT_BYTES,boundedDetail} from './contracts';

/** A callable name: a JS identifier, as GraphQL names are (no dots, slashes or percent escapes). */
const FUNCTION_NAME=/^[_A-Za-z][_0-9A-Za-z]{0,63}$/;
/** The longest JSON input a call carries: the page GraphQL's variables limit. */
export const FUNCTION_INPUT_BYTES=65536;
const MAX_FUNCTIONS=256;
export type FunctionRoles=Readonly<Record<string,DatasetRole>>;
type FunctionKind='query'|'mutation';

/** One backend link as the call sees it: the pinned version's typeDefs ('' when it has none) and its manifest. */
export interface PageFunctionSource {namespace:string;fileId:string;version:string;typeDefs:string;functions:FunctionRoles|null}

/**
 * The manifest a typeDefs-free file publishes: every function its default export names (from the runner), with the
 * role its `roles` declaration gives it — read from the source text (./roles-source `declaredRoles`), never from the
 * evaluated export. Every name and role is checked here, at publish.
 */
export function functionManifest(exported:unknown,roles:ReadonlyArray<readonly [string,string]>|null):Record<string,DatasetRole>{
 if(!Array.isArray(exported)||!exported.length)throw Error('invalid_backend_exports: a backend without typeDefs needs a default export of functions');
 if(exported.length>MAX_FUNCTIONS)throw Error(`A backend offers at most ${MAX_FUNCTIONS} functions`);
 const manifest:Record<string,DatasetRole>=Object.create(null);
 for(const name of exported){
  if(typeof name!=='string'||!FUNCTION_NAME.test(name))throw Error(`Function name ${JSON.stringify(String(name))} is not an identifier`);
  manifest[name]='anonymous';
 }
 for(const [name,role] of roles??[]){
  if(!Object.hasOwn(manifest,name))throw Error(`invalid_roles: roles names ${name}, which the default export does not offer as a function`);
  if(!(DATASET_ROLES as readonly string[]).includes(role))throw Error(`invalid_roles: roles.${name} is ${JSON.stringify(role)}; use one of ${DATASET_ROLES.join(', ')}`);
  manifest[name]=role as DatasetRole;
 }
 return {...manifest};
}

interface Resolved {namespace:string;fileId:string;version:string;rule:{role?:unknown;signedIn?:unknown};kind:FunctionKind|null}
/** A legacy file's fields by name, parsed once per distinct typeDefs. */
const legacy=new Map<string,Map<string,{kind:FunctionKind;rule:{role?:unknown;signedIn?:unknown}}>>();
function legacyFields(typeDefs:string){
 let fields=legacy.get(typeDefs);
 if(fields)return fields;
 fields=new Map();
 try{
  const schema=boundedBackendSchema(typeDefs),auth=schema.getDirective('auth');
  for(const [kind,root] of [['query',schema.getQueryType()],['mutation',schema.getMutationType()]] as const)
   for(const field of Object.values(root?.getFields()??{}))
    fields.set(field.name,{kind,rule:auth&&field.astNode?getDirectiveValues(auth,field.astNode)??{}:{}});
 }catch{/* A version that no longer builds offers nothing. */}
 if(legacy.size>256)legacy.clear();
 legacy.set(typeDefs,fields);
 return fields;
}
function resolve(sources:readonly PageFunctionSource[],name:string):Resolved|'ambiguous'|null{
 if(!FUNCTION_NAME.test(name))return null;
 const found:Resolved[]=[];
 for(const source of sources){
  const at={namespace:source.namespace,fileId:source.fileId,version:source.version};
  if(source.functions){if(Object.hasOwn(source.functions,name))found.push({...at,rule:{role:source.functions[name]},kind:null});continue;}
  if(!source.typeDefs)continue;
  const field=legacyFields(source.typeDefs).get(name);
  if(field)found.push({...at,...field});
 }
 return found.length>1?'ambiguous':found[0]??null;
}

export interface FunctionCall {
 sources:readonly PageFunctionSource[];name:string;method:'GET'|'POST';input:HtmlJsonObject;
 /** The admitted reader; `role` null never reaches here (the composition answers 404 first). */
 caller:PageCaller&{role:DatasetRole};
 /** The call names a revision that is not the head: reads only. */
 archived:boolean;
 /** An opaque origin's call (no credentials, an unframed copy): reads only. */
 readOnly:boolean;
 invoke(call:PageResolverFieldCall):Promise<HtmlJson>;
 signal:AbortSignal;
}
export interface FunctionAnswer {status:number;body:HtmlJson;headers?:Record<string,string>;kind?:FunctionKind}
const refuse=(status:number,error:string,message?:string,headers?:Record<string,string>):FunctionAnswer=>({status,body:message?{error,message}:{error},...(headers?{headers}:{})});

/** Run one function call as its caller and answer it as an HTTP status and JSON body. Never throws. */
export async function callPageFunction(call:FunctionCall):Promise<FunctionAnswer>{
 const found=resolve(call.sources,call.name);
 if(!found)return refuse(404,'unknown_function',`This page has no function ${call.name}`);
 if(found==='ambiguous')return refuse(409,'ambiguous_function',`More than one linked backend offers ${call.name}`);
 const refused=resolverFieldRefusal(call.caller.role,found.rule);
 if(refused==='Sign in required')return refuse(403,'sign_in_required',refused);
 if(refused)return refuse(403,'forbidden',refused);
 const kind:FunctionKind=found.kind??(call.method==='GET'?'query':'mutation');
 if(call.method==='GET'&&kind==='mutation')return refuse(405,'method_not_allowed',`${call.name} changes data: call it with POST`,{Allow:'POST'});
 if(kind==='mutation'&&call.archived)return refuse(403,'archived_page_readonly','An archived revision is read-only');
 if(kind==='mutation'&&call.readOnly)return refuse(403,'read_only','This copy of the page reads only (GET)');
 const owner=call.caller.role==='owner';
 let value:HtmlJson;
 try{
  value=await call.invoke({namespace:found.namespace,fileId:found.fileId,version:found.version,operation:kind,field:call.name,args:call.input,principal:{tenant:call.caller.pageId,subject:call.caller.subject,role:call.caller.role},signal:call.signal});
 }catch(error){
  const {name,code,detail,shown}=(error??{}) as {name?:unknown;code?:unknown;detail?:unknown;shown?:unknown};
  const safe=typeof code==='string'&&FIELD_ERROR_CODE.test(code)?code:'function_failed';
  const ownerDetail=owner?boundedDetail(detail):undefined;
  const extra:Record<string,string>=ownerDetail?{detail:ownerDetail}:{};
  if(name==='FieldNotExecuted'){
   if(safe==='retryable')return {status:503,body:{error:safe,message:'Backend busy; nothing ran, so retrying is safe',...extra},headers:{'Retry-After':'1'}};
   return {status:500,body:{error:safe,message:'The function was refused before it ran',...extra}};
  }
  return {status:safe==='deadline'?504:500,body:{error:safe,message:boundedDetail(shown)??'The function failed',...extra}};
 }
 const body=value===undefined?null:value;
 if(new TextEncoder().encode(JSON.stringify(body)).length>PAGE_OPERATION_RESULT_BYTES)return refuse(500,'result_too_large','The function answered more than 4 MiB');
 return {status:200,body,kind};
}
