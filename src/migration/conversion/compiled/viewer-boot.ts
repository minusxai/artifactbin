import type{CompiledViewerBinding}from'./viewer-contracts.ts';import{validCompiledViewerBinding}from'./viewer-binding.ts';
export function viewerBootSource(binding:CompiledViewerBinding):string{
 if(!validCompiledViewerBinding(binding))throw Error('Invalid viewer routing');
 return `const viewerContent=document.querySelector('[data-migration-viewer-content]');const viewerStatus=document.querySelector('[data-migration-viewer-status]');
 if(!viewerContent||!viewerStatus)throw Error('Reader gate unavailable');
 const viewerDocument=gql\`{legacyData{viewer{generation id}}}\`;
 const viewerAdapter=createCompiledViewer({
 gate:state=>{const ready=state==='ready';viewerContent.hidden=!ready;viewerContent.inert=!ready;if(ready)viewerContent.style.removeProperty('display');else viewerContent.style.setProperty('display','none','important');viewerStatus.textContent=ready?'':state==='pending'?'Loading reader identity…':'Reader identity is unavailable. Reconnect or check access.';},
 clear:()=>{viewerAvailable=false;queryController?.invalidate();setViewer(null);setTables({});},
 apply:async(receipt,signal)=>{signal.throwIfAborted();viewerAvailable=true;setViewer(receipt.id===null?null:{id:receipt.id});const applied=await (queryController?queryController.refreshUntilSettled(signal):run());signal.throwIfAborted();if(!applied)throw Error('Reader queries unavailable');${''}if(typeof flushIdentities==='function')flushIdentities();if(typeof identityFailed!=='undefined'&&identityFailed)throw Error('Reader identities unavailable');},
 watch:next=>{const subscription=client.watchQuery({query:viewerDocument,clearOnRefresh:true}).subscribe(result=>{if(result.errors?.length)next(null);else if(result.data?.legacyData&&Object.hasOwn(result.data.legacyData,'viewer'))next(result.data.legacyData.viewer);else next(undefined);});return()=>subscription.unsubscribe();}
 });
 window.addEventListener('pagehide',event=>{if(!event.persisted)viewerAdapter.dispose();});`;
}
