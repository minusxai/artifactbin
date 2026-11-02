import type {ArtifactHead} from '@/lib/artifact-backend';
export function prepareBlankReport(head:ArtifactHead,observedEditId:string){
 if(head.edit_id!==observedEditId||head.format!=='html'||head.version!==1)throw Error('This artifact has changed. Reload to see the latest version.');
 return {html:'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Untitled report</title></head><body><main><h1>Untitled report</h1><p>Start writing here.</p></main></body></html>',expectedVersion:head.version,expectedState:head.state};
}
