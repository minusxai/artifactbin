import type {UploadContext} from '@artifactbin/contracts';
import type {FileUploadBinding,PlatformUploadControl} from './upload-contract';
type Watch=(listener:(context:UploadContext)=>void)=>{unsubscribe():void};
/** This is guidance from the trusted shell, never proof of an insert grant. */
export function createUploadContext(readOnly:boolean){
 let current:UploadContext={state:readOnly?'read-only':'unavailable',scope:'disconnected'};
 const listeners=new Set<(context:UploadContext)=>void>();
 const emit=(listener:(context:UploadContext)=>void)=>{try{listener({...current});}catch{/* Independent caller controls. */}};
 const watch:Watch=listener=>{listeners.add(listener);emit(listener);return{unsubscribe(){listeners.delete(listener);}};};
 return{read:()=>({...current}),watch,update(next:UploadContext){
  const value=readOnly?{state:'read-only' as const,scope:next.scope}:next;
  if(current.state===value.state&&current.scope===value.scope)return;
  current={...value};for(const listener of listeners)emit(listener);
 }};
}
/** Caller-owned presentation and disabled state; no authentication state is added to the generic element. */
export function bindUploadControl(control:PlatformUploadControl,adapter:NonNullable<PlatformUploadControl['adapter']>,watch:Watch,options:{disabled?:boolean;helperText?:string}={}):FileUploadBinding{
 const previous=control.adapter,helper=options.helperText??control.helperText;
 let disabled=options.disabled??control.disabled,context:UploadContext={state:'unavailable',scope:''},scope:string|undefined,disposed=false;
 control.adapter=adapter;
 const render=()=>{control.disabled=disabled||context.state!=='signed-in';control.helperText=context.state==='signed-in'?helper:context.state==='signed-out'?'Sign in to upload files.':context.state==='loading'?'Checking upload availability…':context.state==='read-only'?'Uploads are read-only.':'Uploads unavailable.';};
 const subscription=watch(next=>{if(disposed)return;if(scope!==next.scope||context.state!==next.state)control.reset();scope=next.scope;context=next;render();});
 return{setDisabled(value){if(disposed)return;disabled=value;render();},dispose(){if(disposed)return;disposed=true;subscription.unsubscribe();control.reset();control.disabled=true;control.adapter=previous;control.helperText=helper;}};
}
