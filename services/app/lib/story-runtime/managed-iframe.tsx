import {useEffect,useRef,useState} from 'react';
import type {ManagedIframeContent} from '@/lib/story/managed-iframe';
import type {DataflowStore} from './store';
import {createManagedAssetResolver,prepareManagedContent,type ManagedAssetsConfig,type ManagedAssetRelay} from './managed-assets';
import {startAuthorScript} from './author-script';
import {managedFrameLayout} from '@/lib/story/managed-frame-layout';
import {managedAuthorDocument} from './managed-author-document';

export { managedAuthorDocument } from './managed-author-document';
export function ManagedIframeView({compiled,store,assets,importAsset,title,height,id,className,'data-mx-ast':ast}:{compiled:ManagedIframeContent;store:DataflowStore;assets?:ManagedAssetsConfig;importAsset?:ManagedAssetRelay;title?:unknown;height?:unknown;id?:string;className?:string;'data-mx-ast'?:string}) {
  const host=useRef<HTMLDivElement>(null),[error,setError]=useState('');
  const {label,pixels}=managedFrameLayout(title,height);
  const content=JSON.stringify(compiled),configuration=JSON.stringify(assets);
  useEffect(()=>{
    if(!host.current)return;
    const target=host.current,resolver=createManagedAssetResolver(assets,importAsset);
    let disposed=false,stop=()=>{};setError('');
    void prepareManagedContent(compiled,resolver,target.ownerDocument).then(prepared=>{
      if(disposed)return;
      stop=startAuthorScript('',store,target.ownerDocument,{host:target,title:label,html:prepared.html,scripts:prepared.scripts,document:managedAuthorDocument(assets?.origin),assets,importAsset});
    }).catch(error=>{if(!disposed)setError(String(error.message).slice(0,500));});
    return()=>{disposed=true;resolver.dispose();stop();target.replaceChildren();};
  },[content,configuration,store,label,importAsset]);
  return <div id={id} className={className} data-mx-ast={ast} data-mx-managed-frame="" aria-label={label} style={{height:pixels,width:'100%'}}><div ref={host} style={{height:'100%'}}/>{error&&<p role="alert">{error}</p>}</div>;
}
