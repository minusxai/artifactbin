import {useCallback,useEffect,useRef,useState} from 'react';
import {useLocation} from 'react-router';
import PageChrome from '@/components/PageChrome';
import FollowButton from '@/components/FollowButton';
import {HomePage} from './pages/Home';
import {useSession} from './session';
import {appFetch} from './api-origin';
import type {ProfileListingData} from '@/components/ProfileListing';
import type {PublicPath,TrustedRegionKind} from './public-page-contract';

/** Only the trusted child fetches session/private state. Messages carry geometry, never rows. */
export function RegionPage({kind,page,main}:{kind:TrustedRegionKind;page:PublicPath;main:string}) {
  const {session}=useSession();
  const address=useLocation();
  const box=useRef<HTMLDivElement>(null);
  const [presentation,setPresentation]=useState<boolean|null>(null);
  const [profile,setProfile]=useState<ProfileListingData|null>(null);
  const present=useCallback((workspace:boolean)=>setPresentation(workspace),[]);
  useEffect(()=>{
    // SSR may start the child before parent hydration installs its listener.
    // Retry the handshake for the same bounded window as the parent's Retry UI.
    let attempts=0;
    const announce=()=>{window.parent.postMessage({type:'mx:page:ready'},main);if(++attempts>=60)clearInterval(timer);};
    const timer=setInterval(announce,250);
    const receive=(event:MessageEvent)=>{if(event.source===window.parent && event.origin===main && event.data?.type==='mx:region:measure')clearInterval(timer);};
    window.addEventListener('message',receive);announce();
    return()=>{clearInterval(timer);window.removeEventListener('message',receive);};
  },[main]);
  useEffect(()=>{
    const publish=(event:Event)=>{if(kind==='chrome')window.parent.postMessage({type:'mx:region:appearance',mode:(event as CustomEvent).detail},main);};
    const receive=(event:MessageEvent)=>{
      if(event.source!==window.parent || event.origin!==main)return;
      if(kind==='chrome' && event.data?.type==='mx:region:measure'){
        window.parent.postMessage({type:'mx:region:appearance',mode:document.documentElement.dataset.theme==='dark'?'dark':'light'},main);return;
      }
      if(event.data?.type!=='mx:page:appearance')return;
      const mode=event.data.mode;if(mode!=='light'&&mode!=='dark')return;
      if(mode==='dark')document.documentElement.dataset.theme='dark';else delete document.documentElement.dataset.theme;
    };
    window.addEventListener('mx:app:appearance',publish);window.addEventListener('message',receive);
    return()=>{window.removeEventListener('mx:app:appearance',publish);window.removeEventListener('message',receive);};
  },[kind,main]);
  useEffect(()=>{
    if(kind!=='follow')return;
    let alive=true;
    const failed=()=>{if(alive)window.parent.postMessage({type:'mx:region:failed'},main);};
    void appFetch(`/api/page/profile/${encodeURIComponent(page.slice(1).replace(/\/$/,''))}`).then(r=>r.ok?r.json():null).then(data=>{if(!alive)return;if(data?.kind==='public-profile')setProfile(data);else failed();}).catch(failed);
    return()=>{alive=false;};
  },[kind,page,main]);
  useEffect(()=>{
    if(kind==='chrome' || kind==='home'&&presentation===null || kind==='follow'&&!profile || !box.current)return;
    const report=()=>window.parent.postMessage({type:'mx:region:ready',height:box.current!.getBoundingClientRect().height,...(kind==='home'?{workspace:presentation}:{})},main);
    const measure=(event:MessageEvent)=>{if(event.source===window.parent && event.origin===main && event.data?.type==='mx:region:measure')report();};
    window.addEventListener('message',measure);
    const observer=new ResizeObserver(report);observer.observe(box.current);report();
    return()=>{observer.disconnect();window.removeEventListener('message',measure);};
  },[kind,main,presentation,profile]);
  if(kind==='chrome')return <PageChrome authed={!!session?.user} anon={session?.kind==='anon'}/>;
  return <div ref={box} style={{display:'flow-root'}}>
    {kind==='home'?<HomePage region onPresentation={present}/>:
      profile?.owner&&profile.follow?<FollowButton userId={profile.owner.id} {...profile.follow} signedIn={!!profile.authed} returnTo={address.pathname+address.search+address.hash}/>:null}
  </div>;
}
