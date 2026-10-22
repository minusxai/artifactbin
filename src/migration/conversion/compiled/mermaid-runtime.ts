import {mermaidPalette} from './mermaid-palette.ts';
import type {PreparedMermaidPlan} from './mermaid-contracts.ts';
/** Solid source is transformed by the same frozen compiler as the surrounding
 * document. Only prepared, sanitized SVG reaches innerHTML; no source evaluator. */
export function mermaidRuntimeSource(plans:readonly PreparedMermaidPlan[]):string {
 const json=JSON.stringify(plans).replaceAll('<','\\u003c');
 return `import {Show,createSignal,createEffect,onMount,onCleanup} from 'solid-js';
import {watchThemeMode} from 'migration-mermaid-theme';
const plans=${json};
const paletteFor=(()=>{const __name=f=>f;return ${mermaidPalette.toString()};})();
const join=(...v)=>v.filter(Boolean).join(' ');
export function Mermaid(p){
 const [shown,setShown]=createSignal(null),[error,setError]=createSignal(null);
 let host,surface;
 createEffect(()=>{const variant=shown();queueMicrotask(()=>{const svg=surface?.querySelector('svg');if(svg&&variant){svg.setAttribute('role','img');svg.setAttribute('aria-label',name());svg.style.width=p.inGridItem?'100%':variant.width+'px';svg.style.maxWidth='100%';svg.style.height=p.inGridItem?'100%':'auto';svg.style.textRendering='geometricPrecision';}});});
 const name=()=>p.title??'Diagram';
 const {code,title,colorMode,imageKey,className,inGridItem,...rest}=p;
 onMount(()=>{
  const plan=plans.find(plan=>plan.id===p.id);
  let generation=0,disposed=false;
  const update=async()=>{
   const current=++generation;
   try{
    if(!plan||p.code!==plan.code||p.title!==plan.title||(p.class??'')!==plan.compiledClass||p.className!==undefined||p.imageKey)throw Error('Unsupported diagram context');
    const themed=host.closest('[data-mx-inline-story]')??host.closest('.dark, .light');
    const root=themed??document.documentElement;
    const mode=root.classList.contains('dark')?'dark':root.classList.contains('light')?'light':p.colorMode??'light';
    const variant=plan.variants[mode];
    if(!variant||JSON.stringify(paletteFor(host,mode==='dark'))!==JSON.stringify(variant.palette))throw Error('Diagram theme or font context changed');
    await Promise.all([document.fonts.load(variant.palette.fontSize+' '+variant.palette.fontFamily,plan.code),document.fonts.load('11px '+variant.palette.fontMono,plan.code)]);
    await document.fonts.ready;if(disposed||current!==generation)return;
    const parsed=new DOMParser().parseFromString(variant.svg,'image/svg+xml');
    const ids=[...parsed.querySelectorAll('[id]')].map(el=>el.id);
    if(ids.some(id=>[...document.querySelectorAll('[id]')].some(el=>el.id===id&&!host.contains(el))))throw Error('Diagram identity collision');
    setError(null);setShown(variant);
   }catch{if(disposed||current!==generation)return;setShown(null);setError('This diagram cannot preserve its authored theme or font context.');}
  };
  update();const stop=watchThemeMode(host,update,()=>true);
  let resizeFrame=0;const resize=new ResizeObserver(()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>update());});resize.observe(host);
  const fonts=()=>update();document.fonts?.addEventListener('loadingdone',fonts);
  onCleanup(()=>{disposed=true;generation++;stop();cancelAnimationFrame(resizeFrame);resize.disconnect();document.fonts?.removeEventListener('loadingdone',fonts);});
 });
 return <figure ref={host} class={join('min-w-0',p.inGridItem?'flex h-full w-full flex-col':'my-4',p.className)} data-mx-mermaid-state={error()?'error':shown()?'ready':'pending'} data-mermaid-type={shown()?.type} {...rest}>
 <figcaption class={p.inGridItem?'border-b border-border px-3 py-2 font-mono text-sm font-medium':'mb-2 font-mono text-sm font-medium'}>{name()}</figcaption>
 <Show when={!error()} fallback={<p role="alert" class={join('text-sm text-destructive',p.inGridItem&&'p-3')}>{error()}</p>}>
 <Show when={shown()} fallback={<p role="status" class={join('text-sm text-muted-foreground',p.inGridItem&&'p-3')}>Rendering diagram…</p>}>
 <span class={p.inGridItem?'min-h-0 w-full flex-1 p-3':'block h-auto max-w-full'} innerHTML={shown()?.svg} ref={surface} />
 </Show></Show></figure>;
}`;
}
