import {appUrl} from './api-origin';

let rightInset = 0;
export function reportControlsInset(value: number): void {
  rightInset = value;
  window.dispatchEvent(new Event('mx:controls:layout'));
}

/** UI runs here; only geometry and addressed navigation cross to the document. */
export function installControlsShell(mainOrigin: string): () => void {
  // Geometry crosses an asynchronous origin boundary. Compositor-driven CSS
  // motion cannot be kept in lockstep with the parent's hit-test clip.
  // Keep controls stationary; this stylesheet never reaches author content.
  const motion = document.createElement('style');
  motion.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}';
  document.head.append(motion);
  const visible = (element: Element) => {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const currentModal = () => [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].filter(visible).at(-1);
  const focusables = (modal: HTMLElement) => [...modal.querySelectorAll<HTMLElement>('button,a[href],input,select,textarea,[tabindex]')].filter(el => el.tabIndex >= 0 && !el.matches(':disabled,[inert]') && visible(el));
  let activeModal: HTMLElement | undefined;
  let restoreFocus: HTMLElement | null = null;
  const focusModal = (modal: HTMLElement) => {
    const first = focusables(modal)[0];
    if (!first && !modal.hasAttribute('tabindex')) modal.tabIndex = -1;
    (first ?? modal).focus({preventScroll:true});
  };
  let pending = false;
  let previous = '';
  const report = () => {
    pending = false;
    const regions: Array<{x:number;y:number;width:number;height:number}> = [];
    const modal = currentModal();
    if (modal !== activeModal) {
      if (!activeModal) restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      activeModal = modal;
      if (modal) focusModal(modal);
      else {if (restoreFocus?.isConnected) restoreFocus.focus({preventScroll:true});restoreFocus=null;}
    }
    if (modal) regions.push({x:0,y:0,width:innerWidth,height:innerHeight});
    else for (const element of document.querySelectorAll('header,nav,aside,[role="dialog"],[role="menu"],[role="listbox"],[role="tooltip"],[data-controls-region],button,a,input,select,textarea')) {
      if (!visible(element)) continue;
      const {x,y,width,height} = element.getBoundingClientRect();
      if (regions.some(r => r.x <= x && r.y <= y && r.x+r.width >= x+width && r.y+r.height >= y+height)) continue;
      regions.push({x,y,width,height});
    }
    const message = {type:'mx:controls:regions',rects:regions,rightInset,modal:!!modal};
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
  window.visualViewport?.addEventListener('resize',schedule);
  window.visualViewport?.addEventListener('scroll',schedule);
  const keys = (event: KeyboardEvent) => {
    const modal = currentModal();
    if (!modal || event.key !== 'Tab' || event.defaultPrevented) return;
    const stops = focusables(modal);
    const first = stops[0], last = stops.at(-1);
    if (!first || !modal.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
      event.preventDefault();
      if (event.shiftKey && last) last.focus();else focusModal(modal);
    }
  };
  const escape = (event: MessageEvent) => {
    if (event.source !== window.parent || event.origin !== mainOrigin || event.data?.type !== 'mx:controls:escape') return;
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  };
  document.addEventListener('keydown',keys);
  window.addEventListener('message',escape);
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
  return () => {observer.disconnect();clearInterval(timer);motion.remove();document.removeEventListener('keydown',keys);window.removeEventListener('message',escape);window.visualViewport?.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);window.removeEventListener('mx:controls:layout',schedule);document.removeEventListener('click',navigate,true);};
}
