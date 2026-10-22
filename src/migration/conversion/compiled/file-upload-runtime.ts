import type {AttachmentReceipt,AttachmentUpload} from "../../../browser/dataset-attachment-bridge-contracts.ts";
import {attachmentRead,attachmentUpload} from "../../../browser/dataset-attachment-validation.ts";
import type {CompiledFileUploadPorts,CompiledFileUploads} from "./file-upload-runtime-contracts.ts";
export function createCompiledFileUploads(ports:CompiledFileUploadPorts):CompiledFileUploads{
  let disposed=false,epoch=0,active=0;
  const allowed=new Set<string>(),selection=new Map<string,number>(),controllers=new Map<AbortController,string|undefined>();
  const images=new Map<string,{valueName:string;controller:AbortController;url?:string}>();
  const intents=new WeakMap<File,Map<string,{request:AttachmentUpload;caller:string;selection:number;receipt?:AttachmentReceipt;pending?:Promise<AttachmentReceipt>}>>();
  const queue:Array<{controller:AbortController;start():void;reject(e:Error):void}>=[];
  const notify=()=>{try{ports.changed();}catch{/* A detached UI cannot retain authority. */}};
  const revoke=(url:string)=>{try{ports.revokeURL(url);}catch{/* Drain every owned URL even if one release fails. */}};
  const authority=()=>{const a=ports.authority();return !disposed&&a?.allowed?a:null;};
  const site=(valueName:string,bindingName?:string)=>ports.sites.find(s=>s.valueName===valueName&&(bindingName===undefined||s.bindingName===bindingName));
  function pump(){
    while(active<2&&queue.length){const job=queue.shift()!;if(job.controller.signal.aborted){job.reject(Error("Attachment caller changed"));continue;}active++;job.start();}
  }
  function run<T>(valueName:string|undefined,fn:(signal:AbortSignal)=>Promise<T>,upload=false):Promise<T>{
    if(disposed||queue.length>=64||(upload&&(active>=2||queue.length)))return Promise.reject(Error("Attachment transport unavailable"));
    const controller=new AbortController();controllers.set(controller,valueName);
    return new Promise<T>((resolve,reject)=>{
      const finish=()=>{controllers.delete(controller);active--;pump();};
      queue.push({controller,reject:e=>{controllers.delete(controller);reject(e);},start(){void Promise.resolve().then(()=>{controller.signal.throwIfAborted();return fn(controller.signal);}).then(resolve,reject).finally(finish);}});
      pump();
    });
  }
  function release(valueName:string){
    selection.set(valueName,(selection.get(valueName)??0)+1);
    for(const [controller,owner]of controllers)if(owner===valueName)controller.abort();
    for(const [key,image]of images)if(image.valueName===valueName){image.controller.abort();if(image.url)revoke(image.url);images.delete(key);}
    pump();notify();
  }
  function reconnect(){
    epoch++;allowed.clear();for(const c of controllers.keys())c.abort();
    for(const image of images.values()){image.controller.abort();if(image.url)revoke(image.url);}images.clear();pump();notify();
    if(!authority()||!ports.transport())return;
    const token=epoch,caller=authority()!.generation;
    const unique=new Map(ports.sites.map(s=>[s.backendNamespace+":"+s.bindingName,s]));
    for(const [key,s]of unique){
      void run(undefined,async signal=>{
        const result=await ports.transport()!.availability({backendNamespace:s.backendNamespace,bindingName:s.bindingName},signal);
        if(!signal.aborted&&token===epoch&&authority()?.generation===caller&&result.canAttempt===true)allowed.add(key);
      }).catch(()=>{}).finally(notify);
    }
  }
  const model:CompiledFileUploads={
    unavailable(valueName){const s=site(valueName);return authority()&&s&&allowed.has(s.backendNamespace+":"+s.bindingName)?null:"File uploads are unavailable.";},
    async upload(valueName,bindingName,file){
      const s=site(valueName,bindingName),caller=authority()?.generation,slot=selection.get(valueName)??0;
      if(!s||!caller||model.unavailable(valueName)||!(file instanceof Blob)||!s.acceptedTypes.includes(file.type as never))throw Error("File upload unavailable");
      let entries=intents.get(file);if(!entries){entries=new Map();intents.set(file,entries);}
      let intent=entries.get(valueName);
      if(intent&&(intent.caller!==caller||intent.selection!==slot))throw Error("Previous upload belongs to a different selection or caller");
      if(!intent){const request={backendNamespace:s.backendNamespace,bindingName:s.bindingName,requestId:ports.id(),filename:file.name,contentType:file.type as AttachmentUpload["contentType"],blob:file};if(!attachmentUpload(request))throw Error("Invalid file upload");intent={request:Object.freeze(request),caller,selection:slot};entries.set(valueName,intent);}
      if(intent.receipt)return intent.receipt;if(intent.pending)return intent.pending;
      const current=intent,token=epoch;
      current.pending=run(valueName,async signal=>{
        const result=await ports.transport()!.upload(current.request,signal);
        if(signal.aborted||token!==epoch||authority()?.generation!==caller||(selection.get(valueName)??0)!==slot)throw Error("File upload outcome unknown");
        current.receipt=result;return result;
      },true);
      try{return await current.pending;}finally{current.pending=undefined;}
    },
    fileUrl(valueName,bindingName,ref){
      const s=site(valueName,bindingName),caller=authority()?.generation;
      if(!s||!caller)return undefined;
      const request={backendNamespace:s.backendNamespace,bindingName:s.bindingName,ref};if(!attachmentRead(request))return undefined;
      const key=valueName+":"+ref,existing=images.get(key);if(existing)return existing.url;
      if(images.size>=64)return undefined;
      const item={valueName,controller:new AbortController(),url:undefined as string|undefined},token=epoch;
      images.set(key,item);
      void run(valueName,async signal=>{
        const result=await ports.transport()!.read(request,AbortSignal.any([signal,item.controller.signal]));
        if(signal.aborted||item.controller.signal.aborted||token!==epoch||authority()?.generation!==caller||images.get(key)!==item)return;
        item.url=ports.createURL(result);notify();
      }).catch(()=>{});
      return undefined;
    },
    release,reconnect,
    dispose(){if(disposed)return;disposed=true;try{stop();}finally{reconnect();}},
  };
  const stop=ports.subscribe(reconnect);reconnect();return model;
}
