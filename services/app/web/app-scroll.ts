import {useLayoutEffect,useRef} from 'react';
import {useLocation,useNavigationType} from 'react-router';

/** Per-entry scroll restoration. Async content gets one bounded observation;
 * a reader gesture or navigation always cancels it. No polling loop. */
export function useAppScroll(): void {
  const location=useLocation(),action=useNavigationType();
  const positions=useRef(new Map<string,[number,number]>());
  const mounted=useRef(false);
  useLayoutEffect(()=>{
    const previous=window.history.scrollRestoration;window.history.scrollRestoration='manual';
    return()=>{window.history.scrollRestoration=previous;};
  },[]);
  useLayoutEffect(()=>{
    const first=!mounted.current;mounted.current=true;
    const saved=positions.current.get(location.key);
    let restoring=false,observer:MutationObserver|undefined,resize:ResizeObserver|undefined,timer:ReturnType<typeof setTimeout>|undefined;
    const remember=()=>{if(!restoring){positions.current.set(location.key,[window.scrollX,window.scrollY]);if(positions.current.size>100)positions.current.delete(positions.current.keys().next().value!);}};
    const stop=()=>{restoring=false;observer?.disconnect();resize?.disconnect();clearTimeout(timer);};
    const gesture=(event:Event)=>{if(event instanceof KeyboardEvent&&!['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(event.key))return;stop();};
    window.addEventListener('scroll',remember,{passive:true});
    for(const name of ['wheel','pointerdown','touchstart','keydown'])window.addEventListener(name,gesture,{capture:true,passive:true});
    const shouldRestore=!!location.hash || (!!saved&&action==='POP');
    if(shouldRestore){
      restoring=true;
      const attempt=()=>{
        if(!restoring)return;
        if(action==='POP'&&saved){window.scrollTo(...saved);if(Math.abs(window.scrollY-saved[1])<1)stop();return;}
        let id=location.hash.slice(1);try{id=decodeURIComponent(id);}catch{/* Preserve malformed fragment text. */}
        const target=document.getElementById(id)??document.getElementsByName(id)[0];
        if(target){target.scrollIntoView({block:'start'});stop();}
      };
      observer=new MutationObserver(attempt);observer.observe(document.body,{childList:true,subtree:true});
      if(typeof ResizeObserver!=='undefined'){resize=new ResizeObserver(attempt);resize.observe(document.body);}
      timer=setTimeout(stop,15_000);attempt();
    }else if(!first)window.scrollTo(0,0);
    else remember();
    return()=>{remember();stop();window.removeEventListener('scroll',remember);for(const name of ['wheel','pointerdown','touchstart','keydown'])window.removeEventListener(name,gesture,true);};
  },[location.key,location.hash,action]);
}
