import type { AttachmentPort, AttachmentReceipt } from "../../../browser/dataset-attachment-bridge-contracts.ts";
import type {LegacyFileUploadSite} from "./file-upload-contracts.ts";
export interface CompiledAttachmentBinding { backendNamespace: string; bindingName: string }
export interface CompiledFileUploadSite extends LegacyFileUploadSite { backendNamespace:string }
export interface CompiledUploadAuthority { generation:string; allowed:boolean }
export interface NativeUploadAdvisoryStore { attachmentUnavailable?(valueName:string):string|null }
export interface CompiledFileUploadPorts {
  sites: readonly CompiledFileUploadSite[];
  authority(): CompiledUploadAuthority | null;
  subscribe(changed:()=>void):()=>void;
  transport(): AttachmentPort | null;
  id():string;
  createURL(blob:Blob):string;
  revokeURL(url:string):void;
  changed():void;
}
export interface CompiledFileUploads {
  unavailable(valueName:string):string|null;
  upload(valueName:string,bindingName:string,file:File):Promise<AttachmentReceipt>;
  fileUrl(valueName:string,bindingName:string,ref:string):string|undefined;
  release(valueName:string):void;
  reconnect():void;
  dispose():void;
}
