import {attachmentScope} from "../../../browser/dataset-attachment-validation.ts";
import {readLegacyFileUploadSites} from "./file-upload-source.ts";
import type {CompiledAttachmentBinding,CompiledFileUploadSite} from "./file-upload-runtime-contracts.ts";
import type {CompiledDatasetBinding} from "./dataset-contracts.ts";
/** Join to existing validated Import metadata; publication remains the server authority. */
export function prepareCompiledFileUploads(source:string,bindings:readonly CompiledAttachmentBinding[]=[],datasets:readonly CompiledDatasetBinding[]=[]):readonly CompiledFileUploadSite[]{
  function refuse():never{throw Error("Unsupported FileUpload registration");}
  const sites=readLegacyFileUploadSites(source);
  if(!Array.isArray(bindings)||bindings.length>32||(!sites.length&&bindings.length))refuse();
  const byName=new Map<string,CompiledAttachmentBinding>();
  for(const binding of bindings){
    if(!attachmentScope(binding)||Object.keys(binding).some(k=>!["backendNamespace","bindingName"].includes(k))||byName.has(binding.bindingName))refuse();
    const matches=datasets.filter(d=>d.name===binding.bindingName&&d.backendNamespace===binding.backendNamespace&&d.mode==="live");
    if(matches.length!==1||!sites.some(s=>s.bindingName===binding.bindingName))refuse();
    byName.set(binding.bindingName,binding);
  }
  const values=new Map<string,string>();
  return sites.map(site=>{
    const binding=byName.get(site.bindingName);if(!binding)refuse();
    const signature=JSON.stringify({...site,disabledSignal:undefined});
    if(values.has(site.valueName)&&values.get(site.valueName)!==signature)refuse();
    values.set(site.valueName,signature);
    return {...site,backendNamespace:binding.backendNamespace};
  });
}
