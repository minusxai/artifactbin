import {createContext,useContext,useEffect,useMemo,useState,type AnchorHTMLAttributes,type ReactNode} from 'react';
import type {MembershipStatus} from '@artifactbin/contracts';
import {isPersonMentionHref} from '@/lib/person-mentions';
import {useOptionalArtifactBackend} from '@/lib/artifact-backend/context';
import {createHttpBackend} from '@/lib/artifact-backend/http';
const EMPTY_STATUSES:Record<string,MembershipStatus>={};
const MentionContext=createContext<Record<string,MembershipStatus>>({});
/** One status request per surface. Only explicitly saved mentions are returned, never private invite details.
 * The surface's backend answers when there is one; a document runtime mounted
 * without a surface keeps reading this artifact's own members door. */
export function PersonMentionProvider({artifactId,initial=EMPTY_STATUSES,children}:{artifactId?:string;initial?:Record<string,MembershipStatus>;children:ReactNode}){
 const [statuses,setStatuses]=useState<Record<string,MembershipStatus>>(initial);
 const surface=useOptionalArtifactBackend();
 const backend=useMemo(()=>surface??(artifactId?createHttpBackend(artifactId):null),[surface,artifactId]);
 useEffect(()=>setStatuses(initial),[initial]);
 useEffect(()=>{
  if(!artifactId||!backend||backend.unavailable('mentions')||window.location.pathname.endsWith('/raw'))return;
  const abort=new AbortController();
  const refresh=()=>{void backend.members(undefined,{signal:abort.signal}).then(r=>{if(r&&!abort.signal.aborted)setStatuses(r.mentions??{});}).catch(()=>{});};
  refresh();const timer=setInterval(refresh,15000);window.addEventListener('focus',refresh);
  return()=>{abort.abort();clearInterval(timer);window.removeEventListener('focus',refresh);};
 },[artifactId,backend]);
 return <MentionContext.Provider value={statuses}>{children}</MentionContext.Provider>;
}
export function PersonMention({href,children,...props}:AnchorHTMLAttributes<HTMLAnchorElement>){
 const states=useContext(MentionContext);
 const status=href&&isPersonMentionHref(href)?states[href.slice('/people/'.length)]:undefined;
 return <a {...props} href={href}>{children}{status==='pending'&&<span className="ml-1 text-xs text-muted-foreground" aria-label="Invitation pending">· Pending</span>}</a>;
}
