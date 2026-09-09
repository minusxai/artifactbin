import { useLayoutEffect,useMemo,useRef,type ReactNode } from 'react';
import { renderReaderChrome, READER_CHROME_HIDDEN_CLASS, type ReaderChromeInput } from '@/lib/story/reader-chrome';
import { STORY_CHROME_CSS } from '@/lib/story-runtime/chrome-css';
import { chromeAfterSample,type ChromeState } from '@/lib/story-runtime/reader-chrome-policy';
import { subscribePageChrome } from './PageChrome';
import { wireReaderSharing } from '@/lib/story-runtime/reader-share';
import { wireGithubWidgetTheme } from '@/lib/github-star';

/** Identical desktop/mobile reader layout, with local handlers inside TrustedUi. */
export function InlineReaderChrome({ input, onAction,pinned=false }: { input: ReaderChromeInput; onAction(action:string):void;pinned?:boolean }): ReactNode {
  const holder=useRef<HTMLDivElement>(null);
  const state=useRef<ChromeState|null>(null);
  const sharing=useRef<ReturnType<typeof wireReaderSharing>|null>(null);
  const html = renderReaderChrome({...input,panels:false}).replaceAll('target="_top"', 'target="_self"');
  const markup=useMemo(()=>({__html:html}),[html]);
  useLayoutEffect(()=>{
    const root=holder.current?.querySelector<HTMLElement>('[data-mx-reader-chrome]');
    if(!root)return;
    sharing.current=wireReaderSharing(window,document,root);
    const stopWidgetTheme=wireGithubWidgetTheme(root);
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
    return ()=>{stopWidgetTheme();stop();sharing.current?.dispose();sharing.current=null;window.cancelAnimationFrame(raf);window.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);};
  },[html,pinned]);
  return <>
    <style>{STORY_CHROME_CSS}</style>
    <div ref={holder} onClick={event => {
      const target = (event.target as Element).closest<HTMLElement>('[data-mx-reader-action],[data-mx-reader-trigger]');
      if (!target) return;
      event.preventDefault();
      if(target.getAttribute('data-mx-reader-action')==='share'){sharing.current?.share();return;}
      onAction(target.getAttribute('data-mx-reader-action') ?? target.getAttribute('data-mx-reader-trigger') ?? '');
    }} dangerouslySetInnerHTML={markup} />
  </>;
}
