import { useLayoutEffect,useRef,type ReactNode } from 'react';
import { renderReaderChrome, READER_CHROME_HIDDEN_CLASS, type ReaderChromeInput } from '@/lib/story/reader-chrome';
import { STORY_CHROME_CSS } from '@/lib/story-runtime/chrome-css';
import { chromeAfterSample,type ChromeState } from '@/lib/story-runtime/reader-chrome-policy';
import { subscribePageChrome } from './PageChrome';
import { wireReaderSharing } from '@/lib/story-runtime/reader-share';
import { wireGithubStar } from '@/lib/github-star';

/** Reconcile only our generated chrome, retaining live browser-owned state.
 * Preserve the fetched GitHub count across reaction/title updates. */
function updateChrome(current: Element, next: Element) {
  if (current.hasAttribute('data-mx-github-star')) return;
  for (const attribute of [...current.attributes]) if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
  for (const attribute of [...next.attributes]) if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
  const oldChildren = [...current.childNodes], newChildren = [...next.childNodes];
  for (let i = 0; i < Math.max(oldChildren.length, newChildren.length); i++) {
    const old = oldChildren[i], fresh = newChildren[i];
    if (!fresh) { old.remove(); continue; }
    if (!old) { current.append(fresh); continue; }
    if (old instanceof Element && fresh instanceof Element && old.tagName === fresh.tagName) updateChrome(old, fresh);
    else if (old.nodeType === Node.TEXT_NODE && fresh.nodeType === Node.TEXT_NODE) {
      if (old.textContent !== fresh.textContent) old.textContent = fresh.textContent;
    } else old.replaceWith(fresh);
  }
}

/** Identical desktop/mobile reader layout, with local handlers inside TrustedUi. */
export function InlineReaderChrome({ input, onAction,pinned=false }: { input: ReaderChromeInput; onAction(action:string):void;pinned?:boolean }): ReactNode {
  const holder=useRef<HTMLDivElement>(null);
  const state=useRef<ChromeState|null>(null);
  const artifact=useRef(input.artifactId);
  const sharing=useRef<ReturnType<typeof wireReaderSharing>|null>(null);
  const html = renderReaderChrome({...input,panels:false}).replaceAll('target="_top"', 'target="_self"');
  useLayoutEffect(()=>{
    const container=holder.current;
    if(!container)return;
    const template=document.createElement('template');template.innerHTML=html;
    const next=template.content.firstElementChild;
    if(!next)return;
    if(container.firstElementChild)updateChrome(container.firstElementChild,next);
    else container.append(next);
    if(artifact.current!==input.artifactId){state.current=null;artifact.current=input.artifactId;}
    const root=holder.current?.querySelector<HTMLElement>('[data-mx-reader-chrome]');
    if(!root)return;
    sharing.current=wireReaderSharing(window,document,root);
    const stopGithubStar=wireGithubStar(root);
    let queued=false;let raf=0;const panels=new Set<string>();
    const paint=(visible:boolean)=>{
      root.classList.toggle(READER_CHROME_HIDDEN_CLASS,!visible);
      root.classList.toggle('mx-reader-chrome--pinned',pinned);
      root.setAttribute('data-mx-reader-state',visible?'shown':'hidden');
    };
    const sample=()=>{
      queued=false;
      if(pinned||panels.size){paint(true);return;}
      state.current=chromeAfterSample(state.current,{scrollY:Math.max(0,window.scrollY),viewportHeight:window.innerHeight,documentHeight:document.documentElement.scrollHeight});
      paint(state.current.visible);
    };
    const schedule=()=>{if(!queued){queued=true;raf=window.requestAnimationFrame(sample);}};
    const stop=subscribePageChrome((which,open)=>{
      if(open)panels.add(which);else panels.delete(which);
      const trigger=root.querySelector<HTMLElement>(`[data-mx-reader-trigger="${which}"]`);
      trigger?.setAttribute('aria-expanded',String(open));sample();
    });
    window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);
    sample();
    return ()=>{stopGithubStar();stop();sharing.current?.dispose();sharing.current=null;window.cancelAnimationFrame(raf);window.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);};
  },[html,pinned,input.artifactId]);
  return <>
    <style>{STORY_CHROME_CSS}</style>
    <div ref={holder} onClick={event => {
      const target = (event.target as Element).closest<HTMLElement>('[data-mx-reader-action],[data-mx-reader-trigger]');
      if (!target) return;
      event.preventDefault();
      if(target.getAttribute('data-mx-reader-action')==='share'){sharing.current?.share();return;}
      onAction(target.getAttribute('data-mx-reader-action') ?? target.getAttribute('data-mx-reader-trigger') ?? '');
    }} />
  </>;
}
