import type {DatasetUploadResult} from '@artifactbin/contracts';
/** An upload is an explicit write; abort/disconnect can leave an unknown result. Retry the same File/requestId to recover. */
export interface FileUploadOptions {dataset:string;signal?:AbortSignal;requestId?:string}
export interface FileUploadRequest {datasetId:string;filename:string;contentType:string;requestId:string;bytes:Uint8Array}
export interface FileUploadTransport {send(request:FileUploadRequest,signal?:AbortSignal):Promise<DatasetUploadResult>}
export interface FileUploader {
 upload(file:File,options:FileUploadOptions):Promise<DatasetUploadResult>;
}

/** Structural port: custom controls remain transport/account agnostic. */
export interface PlatformUploadControl {
 disabled:boolean;
 helperText:string;
 adapter?:{upload(file:File,options:{dataset:string;signal:AbortSignal}):Promise<{ref:string;name:string;contentType?:string;size?:number}>;fileUrl?(file:{ref:string;name:string;contentType?:string;size?:number},dataset:string):string};
 reset():void;
}
export interface FileUploadBinding {setDisabled(disabled:boolean):void;dispose():void}
