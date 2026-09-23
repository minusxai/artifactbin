import {useEffect,useId} from 'react';
export type PagePanelName = 'menu' | 'controls' | 'notifications';
const OPEN_EVENT = 'mx:page-chrome-open';
/** The framed document's chrome asks the page to open one of its panels. */
const REQUEST_EVENT = 'mx:page-chrome-request';
/** A panel says whether it is open, so the bar's button can show the X. */
const STATE_EVENT = 'mx:page-chrome-state';
export function announcePanel(which: PagePanelName, open: boolean) {
  window.dispatchEvent(new CustomEvent(STATE_EVENT, { detail: { which, open } }));
}
export function requestPageChrome(which: PagePanelName) {
  window.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail: which }));
}
export function subscribePageChrome(listener:(which:PagePanelName,open:boolean)=>void):()=>void {
  const receive=(event:Event)=>{
    const detail=(event as CustomEvent<{which:PagePanelName;open:boolean}>).detail;
    if(detail && (detail.which==='menu'||detail.which==='controls'||detail.which==='notifications') && typeof detail.open==='boolean') listener(detail.which,detail.open);
  };
  window.addEventListener(STATE_EVENT,receive);
  return ()=>window.removeEventListener(STATE_EVENT,receive);
}
export function useExclusiveLayer(open: boolean, setOpen: (open: boolean) => void) {
  const id = useId();
  useEffect(() => {
    const closeOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) setOpen(false);
    };
    window.addEventListener(OPEN_EVENT, closeOther);
    return () => window.removeEventListener(OPEN_EVENT, closeOther);
  }, [id, setOpen]);
  const toggle = () => {
    const next = !open;
    if (next) window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
    setOpen(next);
  };
  return toggle;
}

/** Open on the framed chrome's request — exclusively, like a click on the trigger. */
export function useOpenOnRequest(which: PagePanelName, open: boolean, setOpen: (open: boolean) => void) {
  const id = useId();
  useEffect(() => {
    const onRequest = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== which) return;
      if (open) { setOpen(false); return; }
      window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
      setOpen(true);
    };
    window.addEventListener(REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(REQUEST_EVENT, onRequest);
  }, [id, open, setOpen, which]);
}

