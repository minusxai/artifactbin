import {useEffect, useRef, useState, type ReactNode} from 'react';
import type {PublicPath, TrustedRegionKind} from '@/web/public-page-contract';
import {controlsClipPath} from '@/lib/story-runtime/controls-regions';
import {isPlatformPage} from '@artifactbin/utils/platform-pages';

export interface TrustedRegionProps {
  kind: TrustedRegionKind;
  page: PublicPath;
  controls: string;
  search?:string;
  fallback: ReactNode;
  onWorkspace?: (workspace: boolean) => void;
}
/** Owns exact source/origin checks, sizing, readiness, retry and public navigation. */
export function TrustedRegion({kind,page,controls,search='',fallback,onWorkspace}: TrustedRegionProps) {
  const frame=useRef<HTMLIFrameElement>(null);
  const loaded=useRef(false);
  const [ready,setReady]=useState(false), [failed,setFailed]=useState(false), [attempt,setAttempt]=useState(0);
  const [height,setHeight]=useState(1), [clip,setClip]=useState('inset(100%)');
  const [privateWorkspace,setPrivateWorkspace]=useState(false);
  const workspace=useRef(onWorkspace);workspace.current=onWorkspace;
  useEffect(()=>{
    setReady(false);setFailed(false);setPrivateWorkspace(false);loaded.current=false;
    let releaseModal:(()=>void)|undefined;
    const setModal=(modal:boolean)=>{
      if(!modal){releaseModal?.();releaseModal=undefined;return;}
      if(releaseModal || !frame.current)return;
      const saved:Array<[HTMLElement,boolean]>=[];
      const focus=document.activeElement instanceof HTMLElement?document.activeElement:null;
      for(let node:HTMLElement|null=frame.current;node?.parentElement;node=node.parentElement){
        for(const sibling of node.parentElement.children){
          if(sibling!==node && sibling instanceof HTMLElement){saved.push([sibling,!!sibling.inert]);sibling.inert=true;}
        }
        if(node.parentElement===document.body)break;
      }
      releaseModal=()=>{for(const [node,inert] of saved)node.inert=inert;if(focus?.isConnected)focus.focus({preventScroll:true});};
    };
    const hash=()=>{if(loaded.current)frame.current?.contentWindow?.postMessage({type:'mx:page:hash',hash:location.hash},controls);};
    const timer=setTimeout(()=>setFailed(true),15000);
    const receive=(event:MessageEvent)=>{
      if(event.source!==frame.current?.contentWindow || event.origin!==controls)return;
      const data=event.data;
      if(data?.type==='mx:page:ready'){loaded.current=true;hash();frame.current?.contentWindow?.postMessage({type:'mx:region:measure'},controls);return;}
      if(data?.type==='mx:page:history' && (data.delta===-1 || data.delta===1)){history.go(data.delta);return;}
      if(kind==='chrome' && data?.type==='mx:region:appearance' && (data.mode==='light'||data.mode==='dark')){
        if(data.mode==='dark')document.documentElement.dataset.theme='dark';else delete document.documentElement.dataset.theme;
        try{localStorage.setItem('mx_theme',data.mode);}catch{/* Storage is optional. */}
        window.dispatchEvent(new CustomEvent('mx:public:appearance',{detail:data.mode}));return;
      }
      if(data?.type==='mx:region:failed'){setFailed(true);clearTimeout(timer);return;}
      if(data?.type==='mx:controls:regions')setModal(data.modal===true);
      if(kind==='chrome' && data?.type==='mx:controls:regions'){
        setClip(controlsClipPath(data.rects,innerWidth,innerHeight));
        setReady(true);clearTimeout(timer);setFailed(false);
        return;
      }
      if(kind!=='chrome' && data?.type==='mx:region:ready' && typeof data.height==='number' && Number.isFinite(data.height) && data.height>=0 && data.height<=100000){
        setHeight(Math.ceil(data.height));setReady(true);clearTimeout(timer);setFailed(false);
        if(kind==='home' && typeof data.workspace==='boolean'){setPrivateWorkspace(data.workspace);workspace.current?.(data.workspace);}
        return;
      }
      if(data?.type!=='mx:controls:navigate' || typeof data.url!=='string')return;
      try{
        const target=new URL(data.url);
        if(target.origin!==location.origin || target.username || target.password)return;
        if(!isPlatformPage(target.pathname) && !/^\/(?:a\/[A-Za-z0-9]+|@[\w-]+(?:\/[\w-]+)*|docs(?:\/[\w.-]+)*)\/?$/.test(target.pathname))return;
        if(data.replace===true)location.replace(target.href);else location.assign(target.href);
      }catch{/* Invalid navigation fails closed. */}
    };
    const appearance=(event:Event)=>{if(loaded.current)frame.current?.contentWindow?.postMessage({type:'mx:page:appearance',mode:(event as CustomEvent).detail},controls);};
    window.addEventListener('message',receive);
    window.addEventListener('hashchange',hash);window.addEventListener('popstate',hash);window.addEventListener('mx:public:appearance',appearance);
    return()=>{releaseModal?.();clearTimeout(timer);window.removeEventListener('message',receive);window.removeEventListener('hashchange',hash);window.removeEventListener('popstate',hash);window.removeEventListener('mx:public:appearance',appearance);};
  },[kind,page,search,controls,attempt]);
  const chrome=kind==='chrome';
  return <div data-trusted-region={kind} className="relative" style={chrome?{height:44}:undefined} aria-busy={!ready}>
    {!ready && <div inert aria-hidden="true">{fallback}</div>}
    {failed && <button type="button" aria-label={`Retry loading ${kind}`} onClick={()=>setAttempt(n=>n+1)} className="relative z-[70] cursor-pointer rounded border border-edge bg-surface px-3 py-2 text-fg">Retry loading {kind}</button>}
    <iframe key={`${kind}:${page}:${search}:${attempt}`} ref={frame} title={chrome?'Page controls':kind==='home'?'Home workspace':'Profile follow'}
      src={`${controls}/controls/region/${kind}?page=${encodeURIComponent(page)}&search=${encodeURIComponent(search)}`}
      onLoad={()=>{loaded.current=true;frame.current?.contentWindow?.postMessage({type:'mx:page:hash',hash:location.hash},controls);}}
      referrerPolicy="no-referrer" allow="clipboard-write" aria-hidden={!ready?true:undefined} tabIndex={ready?undefined:-1} inert={!ready}
      style={chrome?{position:'fixed',inset:0,width:'100%',height:'100%',border:0,zIndex:2147483000,clipPath:clip,background:'transparent'}:
        {display:'block',width:'100%',height:ready?(privateWorkspace?'calc(100dvh - 44px)':height):1,border:0,visibility:ready?'visible':'hidden',...(ready?{}:{position:'absolute',pointerEvents:'none'})}}/>
  </div>;
}
