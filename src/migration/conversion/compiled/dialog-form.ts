import type {CompiledDialogForm,CompiledDialogFormPorts} from "./dialog-form-contracts.ts";
import type {CompiledMutationScalar} from "./dataset-mutations-contracts.ts";
function receipt(value:unknown):boolean {
 if(!value||typeof value!=="object"||Array.isArray(value))return false;
 const fields=Object.getOwnPropertyDescriptors(value);
 return ['affected','rowCount','version','generation'].every(name=>{
  const field=fields[name];return !!field&&'value'in field&&Number.isSafeInteger(field.value)&&field.value>=(name==='version'||name==='generation'?1:0);
 });
}
function snapshot(value:Readonly<Record<string,CompiledMutationScalar>>|undefined){
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Reflect.ownKeys(value).length>256)throw Error('Invalid form arguments');
 const result:Record<string,CompiledMutationScalar>={};
 for(const key of Reflect.ownKeys(value)){
  const field=Object.getOwnPropertyDescriptor(value,key)!;
  if(typeof key!=='string'||!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)||['__proto__','constructor','prototype'].includes(key)||!('value'in field))throw Error('Invalid form arguments');
  const v=field.value;
  if(!(v===null||typeof v==='boolean'||typeof v==='string'&&new TextEncoder().encode(v).length<=65536||typeof v==='number'&&Number.isFinite(v)))throw Error('Invalid form arguments');
  result[key]=v;
 }
 return result;
}
/** Owns a form attempt's UI lifecycle. Dispatch/reconciliation stay with the durable adapter. */
export function createCompiledDialogForm(ports:CompiledDialogFormPorts):CompiledDialogForm {
 let busy=false,disposed=false,error:string|null=null;
 const listeners=new Set<()=>void>();
 const emit=()=>{if(!disposed)for(const listener of listeners){try{listener();}catch{/* A listener cannot interrupt attempt cleanup. */}}};
 const unavailable=()=>{try{return ports.unavailable()??(ports.authorizationContext()?null:'Shared data editing is unavailable.');}catch{return 'Shared data editing is unavailable.';}};
 const unknown=()=>{try{return ports.unknown();}catch{return false;}};
 const execute=async(reconcile:boolean)=>{
  if(disposed||busy||unavailable()!==null||reconcile!==unknown())return;
  if(!reconcile&&!ports.validate())return;
  const context=ports.authorizationContext();
  if(!context)return;
  busy=true;error=null;ports.busy(true);emit();
  try{
   const args=reconcile?undefined:snapshot(ports.args());
   if(disposed||ports.authorizationContext()!==context||unavailable()!==null)throw Error('Form authority changed before saving');
   const result=await(reconcile?ports.reconcile():ports.mutate(args));
   if(!receipt(result))throw Error('The save was not confirmed.');
   if(!disposed&&ports.authorizationContext()===context&&unavailable()===null)ports.close();
  }catch(failure){
   if(!disposed&&ports.authorizationContext()===context)error=failure instanceof Error?failure.message:'That did not save';
  }finally{busy=false;if(!disposed)ports.busy(false);emit();}
 };
 return {
  state:()=>({busy,error,unavailable:unavailable(),unknown:unknown(),canReconcile:!disposed&&!busy&&unavailable()===null&&unknown()}),
  submit:()=>execute(false),reconcile:()=>execute(true),refresh:emit,
  subscribe(listener){if(disposed)return()=>{};listeners.add(listener);return()=>listeners.delete(listener);},
  dispose(){if(disposed)return;disposed=true;busy=false;listeners.clear();ports.busy(false);}
 };
}
