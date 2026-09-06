import {appUrl} from './api-origin';

let rightInset = 0;
export function reportControlsInset(value: number): void {
  rightInset = value;
  window.dispatchEvent(new Event('mx:controls:layout'));
}

/** UI runs here; only geometry and addressed navigation cross to the document. */
export function installControlsShell(mainOrigin: string): () => void {
  let pending = false;
  let previous = '';
  const report = () => {
    pending = false;
    const regions: Array<{x:number;y:number;width:number;height:number}> = [];
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const modal = [...document.querySelectorAll('[aria-modal="true"]')].some(visible);
    if (modal) regions.push({x:0,y:0,width:innerWidth,height:innerHeight});
    else for (const element of document.querySelectorAll('header,nav,aside,[role="dialog"],[role="menu"],[role="listbox"],[role="tooltip"],[data-controls-region],button,a,input,select,textarea')) {
      if (!visible(element)) continue;
      const {x,y,width,height} = element.getBoundingClientRect();
      if (regions.some(r => r.x <= x && r.y <= y && r.x+r.width >= x+width && r.y+r.height >= y+height)) continue;
      regions.push({x,y,width,height});
    }
    const message = {type:'mx:controls:regions',rects:regions,rightInset};
    const serialized = JSON.stringify(message);
    if (serialized !== previous) {previous = serialized; window.parent.postMessage(message,mainOrigin);}
  };
  // The parent initially clips the entire frame. Chromium suspends animation
  // frames in fully clipped iframes, so geometry must bootstrap on a task.
  const schedule = () => {if (!pending) {pending = true; setTimeout(report,0);}};
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true});
  const timer = setInterval(schedule,250);
  window.addEventListener('resize',schedule);
  window.addEventListener('scroll',schedule,true);
  window.addEventListener('mx:controls:layout',schedule);
  const navigate = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]');
    if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
    const url = new URL(appUrl(anchor.getAttribute('href')!),location.origin);
    if (url.origin !== mainOrigin) return;
    event.preventDefault();event.stopPropagation();
    window.parent.postMessage({type:'mx:controls:navigate',url:url.href},mainOrigin);
  };
  document.addEventListener('click',navigate,true);
  schedule();
  return () => {observer.disconnect();clearInterval(timer);window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);window.removeEventListener('mx:controls:layout',schedule);document.removeEventListener('click',navigate,true);};
}
