import {Router,createPath,type Navigator} from 'react-router';
import {useEffect,useState,type ReactNode} from 'react';
import {appNavigate,appUrl} from './api-origin';
import {rewritePublicLinks} from './public-links';

/** The main address owns history; frame-local routing never adds hidden entries. */
export function PageFrameRouter({path,main,children,search=window.location.search}:{path:string;main:string;children:ReactNode;search?:string}) {
  const [hash,setHash]=useState(window.location.hash);
  const navigator:Navigator={
    createHref:to=>appUrl(typeof to==='string'?to:createPath(to)),
    push:to=>appNavigate(typeof to==='string'?to:createPath(to)),
    replace:to=>appNavigate(typeof to==='string'?to:createPath(to),true),
    go:delta=>window.parent.postMessage({type:'mx:page:history',delta},main),
  };
  useEffect(()=>{
    const address=(event:MessageEvent)=>{
      if(event.source!==window.parent || event.origin!==main || event.data?.type!=='mx:page:hash' || typeof event.data.hash!=='string' || (event.data.hash!=='' && !event.data.hash.startsWith('#')))return;
      setHash(event.data.hash);
      if(!event.data.hash){window.scrollTo(0,0);return;}
      try{document.getElementById(decodeURIComponent(event.data.hash.slice(1)))?.scrollIntoView();}catch{/* Malformed fragments have no target. */}
    };
    window.addEventListener('message',address);
    const update=()=>{
      rewritePublicLinks();
      window.parent.postMessage({type:'mx:page:title',title:document.title},main);
    };
    const navigate=(event:MouseEvent)=>{
      if(event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return;
      const anchor=(event.target as Element|null)?.closest<HTMLAnchorElement>('a[href]');
      if(!anchor || anchor.target==='_blank' || anchor.hasAttribute('download'))return;
      const target=new URL(anchor.href);
      if(target.origin!==main)return;
      event.preventDefault();appNavigate(target.href);
    };
    const observer=new MutationObserver(update);observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['href']});
    document.addEventListener('click',navigate,true);update();
    window.parent.postMessage({type:'mx:page:ready'},main);
    return()=>{observer.disconnect();document.removeEventListener('click',navigate,true);window.removeEventListener('message',address);};
  },[main]);
  return <Router location={path+search+hash} navigator={navigator}>{children}</Router>;
}
