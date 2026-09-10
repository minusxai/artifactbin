import type { ManagedCommentEvent, ManagedCommentState, ManagedCommentSelection } from './managed-comment-contract';
import type { IframeNodeTarget } from '@/lib/story/comment-target';
import type { AnnotationRect } from '@/lib/story/annotation-range';

/** Self-contained child-realm installer. Keep all runtime dependencies inside this function:
 * its source is embedded in the opaque frame's classic bootstrap, never executed in the host. */
export function createManagedCommentRuntime(win: Window, send: (message: ManagedCommentEvent) => void): {
  update(state: ManagedCommentState): void;
  dispose(): void;
} {
  const doc = win.document;
  let state: ManagedCommentState | null = null;
  let disposed = false;
  let sequence = 0;
  const sessions = new WeakMap<Element, string>();
  const listeners: Array<() => void> = [];
  let timer: number | null = null;
  let longPress: number | null = null;
  let down: {x:number;y:number;node:Element} | null = null;
  let suppressClick = false;
  let hovered: Element | null = null;
  let action: HTMLElement | null = null;
  let overlay: HTMLElement | null = null;
  let lastOpen: string | null = null;
  let revealed: Element | null = null;
  const canonical = (s: string) => s.replace(/\s+/g, ' ').trim();
  const rect = (el: Element): AnnotationRect => {
    const r = el.getBoundingClientRect();
    return {x:r.x,y:r.y,width:r.width,height:r.height};
  };
  const internal = (el: Element) => !!el.closest('[data-mx-comment-ui]');
  const eligible = (el: Element) => !internal(el) && !/^(HTML|HEAD|SCRIPT|STYLE|META|LINK|NOSCRIPT)$/.test(el.tagName);
  const target = (el: Element): IframeNodeTarget => {
    // A key only identifies its own element, never an unkeyed descendant.
    if (el.hasAttribute('data-comment-key')) {
      const path: string[] = [];
      for (let node: Element | null = el; node; node = node.parentElement) {
        const key = node.getAttribute('data-comment-key');
        if (key) path.unshift(key);
      }
      if (path.length && path.length <= 32 && path.every(k => k.length <= 256)) return {kind:'key',path};
    }
    if (el.id) return {kind:'source',id:el.id};
    let id = sessions.get(el);
    if (!id) { id = String(++sequence); sessions.set(el,id); }
    return {kind:'session',generation:state!.generation,id};
  };
  const resolve = (t: IframeNodeTarget): {node?:Element;status:'exact'|'missing'|'ambiguous'} => {
    if(t.kind==='session' && t.generation!==state?.generation) return {status:'missing'};
    const matches = Array.from(doc.body.querySelectorAll('*')).concat(doc.body).filter(el => {
      if(!eligible(el)) return false;
      if(t.kind==='source') return el.id===t.id;
      if(t.kind==='session') return sessions.get(el)===t.id;
      if(!el.hasAttribute('data-comment-key')) return false;
      return JSON.stringify(target(el))===JSON.stringify(t);
    });
    return matches.length===1 ? {node:matches[0],status:'exact'} : {status:matches.length?'ambiguous':'missing'};
  };
  const clearAction = () => { action?.remove(); action=null; };
  const layer = () => {
    if(!overlay?.isConnected) {
      overlay=doc.createElement('div');overlay.setAttribute('data-mx-comment-ui','');
      overlay.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
      doc.documentElement.append(overlay);
    }
    return overlay;
  };
  const draw = (r:AnnotationRect, active:boolean) => {
    const box=doc.createElement('div');box.style.cssText=`position:absolute;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;box-sizing:border-box;border:2px solid #e3b341;background:${active?'rgba(227,179,65,.22)':'rgba(227,179,65,.06)'};border-radius:3px;pointer-events:none;`;
    layer().append(box);
  };
  const rangeRects = (node:Element, range:ManagedCommentSelection['range']):AnnotationRect[] => {
    const r=rect(node);
    if(range?.kind==='area') {
      const b=range.box;return [{x:r.x+b.x*r.width,y:r.y+b.y*r.height,width:b.w*r.width,height:b.h*r.height}];
    }
    if(range && 'parts' in range) {
      const out:AnnotationRect[]=[];
      for(const part of range.parts) {
        let scope:Element|null=node;
        if(part.rel) {
          const m=/^(?:\+(\d+)(?:\.|$))?(.*)$/.exec(part.rel);
          if(!m) continue;
          for(let i=0;i<Number(m[1]||0)&&scope;i++) scope=scope.nextElementSibling;
          for(const step of m[2].split('.').filter(Boolean)) scope=scope?.children[Number(step)]??null;
        }
        if(!scope) continue;
        const walker=doc.createTreeWalker(scope,4);const nodes:Text[]=[];let n:Node|null;
        while((n=walker.nextNode())) nodes.push(n as Text);
        const raw=nodes.map(n=>n.data).join('');
        // Canonical offsets mapped back to original text, including collapsed whitespace.
        let text='';const offsets:number[]=[];
        for(let i=0;i<raw.length;i++) {if(/\s/.test(raw[i])) {if(text && !text.endsWith(' ')){text+=' ';offsets.push(i);}} else {text+=raw[i];offsets.push(i);}}
        text=text.trimEnd();let at=-1;
        for(let i=text.indexOf(part.text);i>=0;i=text.indexOf(part.text,i+1)) if(at<0||Math.abs(i-part.start)<Math.abs(at-part.start)) at=i;
        if(at<0) continue;
        const locate=(offset:number):[Text,number]|null=>{for(const n of nodes){if(offset<=n.length)return[n,offset];offset-=n.length;}return null;};
        const a=locate(offsets[at]),b=locate(offsets[at+part.text.length-1]+1);
        if(a&&b){const domRange=doc.createRange();domRange.setStart(...a);domRange.setEnd(...b);if(domRange.getClientRects)for(const q of domRange.getClientRects())out.push({x:q.x,y:q.y,width:q.width,height:q.height});}
      }
      if(out.length)return out;
    }
    return [r];
  };
  const marks=['data-mx-annotated','data-mx-annotation-open','data-mx-annotation-hover','data-mx-annotate-selected','data-mx-annotate-pick-hover'];
  const marked=new Set<Element>();
  const mark=(node:Element,name:string)=>{node.setAttribute(name,'');marked.add(node);};
  const clearMarks=()=>{for(const node of marked)for(const name of marks)node.removeAttribute(name);marked.clear();};
  const repaint = () => {
    if(disposed||!state)return;
    overlay?.replaceChildren();clearMarks();
    if(!state.enabled) {overlay?.remove();return;}
    const positions:Extract<ManagedCommentEvent,{type:'comment-layout'}>['positions']=[];
    for(const pin of state.pins) {
      const found=resolve(pin.target);let r:AnnotationRect={x:0,y:0,width:0,height:0};
      if(found.node){
        mark(found.node,'data-mx-annotated');if(state.openId===pin.id)mark(found.node,'data-mx-annotation-open');if(state.hoverId===pin.id)mark(found.node,'data-mx-annotation-hover');
        if(state.openId===pin.id && (lastOpen!==pin.id || revealed!==found.node)) {found.node.scrollIntoView?.({block:'nearest',inline:'nearest'});revealed=found.node;}
        const rs=rangeRects(found.node,pin.range??undefined);r=rs[0];
        for(const box of rs)draw(box,state.openId===pin.id||state.hoverId===pin.id);
        const button=doc.createElement('button');button.type='button';button.textContent='●';button.setAttribute('aria-label','Open comment');
        button.style.cssText=`position:absolute;left:${Math.max(0,r.x+r.width-12)}px;top:${Math.max(0,r.y)}px;pointer-events:auto;background:#e3b341;color:#181818;border:0;border-radius:50%;width:24px;height:24px;cursor:pointer;`;
        button.onclick=()=>send({type:'comment-pin',generation:state!.generation,id:pin.id,rect:r});
        button.onmouseenter=()=>send({type:'comment-hover',generation:state!.generation,id:pin.id});
        button.onmouseleave=()=>send({type:'comment-hover',generation:state!.generation,id:null});layer().append(button);
      }
      positions.push({id:pin.id,rect:r,status:found.status});
    }
    lastOpen=state.openId;if(!lastOpen)revealed=null;
    let selectionRect:AnnotationRect|null=null;
    if(state.selection){const found=resolve(state.selection.target);if(found.node){mark(found.node,'data-mx-annotate-selected');selectionRect=rangeRects(found.node,state.selection.range)[0];for(const r of rangeRects(found.node,state.selection.range))draw(r,true);}}
    if(state.picking&&hovered?.isConnected){mark(hovered,'data-mx-annotate-pick-hover');draw(rect(hovered),true);}
    send({type:'comment-layout',generation:state.generation,positions,selectionRect});
  };
  const schedule = () => {if(timer===null&&!disposed)timer=win.setTimeout(()=>{timer=null;repaint();},32);};
  const emit = (node:Element, range?:ManagedCommentSelection['range'],quote?:string) => {
    if(!state?.enabled||!state.canComment)return;
    const selection={target:target(node),rect:rangeRects(node,range)[0],...(range?{range}:{}),...(quote?{quote}:{})};
    state={...state,selection};clearAction();send({type:'comment-selection',generation:state.generation,selection});repaint();
  };
  const element = (e:Event) => {const n=e.target as Node|null;const el=n?.nodeType===1?n as Element:n?.parentElement;return el&&eligible(el)?el:null;};
  const active = () => !!(state?.enabled&&state.canComment&&state.picking);
  const listen = (name:string,handler:(event:Event)=>void) => {doc.addEventListener(name,handler,true);listeners.push(()=>doc.removeEventListener(name,handler,true));};
  const showAction = (x:number,y:number,select:()=>void,withComment:boolean) => {
    clearAction();action=doc.createElement('div');action.setAttribute('data-mx-comment-ui','');
    action.style.cssText=`position:fixed;left:${Math.max(4,Math.min(x,win.innerWidth-160))}px;top:${Math.max(4,Math.min(y,win.innerHeight-44))}px;z-index:2147483647;display:flex;gap:4px;background:#242424;padding:4px;border-radius:6px;color:white;`;
    const button=(label:string,fn:()=>void)=>{const b=doc.createElement('button');b.type='button';b.textContent=label;b.style.cssText='font:14px sans-serif;background:transparent;color:inherit;border:0;padding:8px;cursor:pointer;';b.onpointerdown=e=>e.preventDefault();b.onclick=e=>{e.stopPropagation();fn();clearAction();};action!.append(b);};
    if(withComment)button('Comment',select);
    button('Select',()=>{send({type:'comment-select-mode',generation:state!.generation});state={...state!,picking:true};repaint();});
    doc.documentElement.append(action);
  };
  listen('mouseover',e=>{if(active()){hovered=element(e);schedule();}});
  listen('pointerdown',e=>{
    const p=e as PointerEvent,n=element(e);if(!n||p.button>0)return;
    clearAction();down={x:p.clientX,y:p.clientY,node:n};
    if(active()){e.preventDefault();e.stopPropagation();}
    else if(state?.enabled&&state.canComment&&p.pointerType==='touch')longPress=win.setTimeout(()=>{longPress=null;suppressClick=true;showAction(p.clientX,p.clientY,()=>emit(n),true);},550);
  });
  listen('pointermove',e=>{const p=e as PointerEvent;if(down&&(Math.abs(p.clientX-down.x)>6||Math.abs(p.clientY-down.y)>6)){if(longPress!==null){win.clearTimeout(longPress);longPress=null;}if(active()){overlay?.replaceChildren();draw({x:Math.min(p.clientX,down.x),y:Math.min(p.clientY,down.y),width:Math.abs(p.clientX-down.x),height:Math.abs(p.clientY-down.y)},true);}}});
  listen('pointerup',e=>{
    if(longPress!==null){win.clearTimeout(longPress);longPress=null;}
    const p=e as PointerEvent,start=down;down=null;
    if(!active()||!start)return;
    e.preventDefault();e.stopPropagation();suppressClick=true;
    if(Math.abs(p.clientX-start.x)<6&&Math.abs(p.clientY-start.y)<6){emit(start.node);return;}
    let node=start.node;const end=doc.elementFromPoint?.(p.clientX,p.clientY);
    while(end&&!node.contains(end)&&node.parentElement&&node!==doc.body)node=node.parentElement;
    const a=rect(node),x=Math.max(a.x,Math.min(p.clientX,start.x)),y=Math.max(a.y,Math.min(p.clientY,start.y));
    const right=Math.min(a.x+a.width,Math.max(p.clientX,start.x)),bottom=Math.min(a.y+a.height,Math.max(p.clientY,start.y));
    if(a.width>0&&a.height>0&&right>x&&bottom>y)emit(node,{v:1,kind:'area',box:{x:(x-a.x)/a.width,y:(y-a.y)/a.height,w:(right-x)/a.width,h:(bottom-y)/a.height}});
  });
  listen('pointercancel',()=>{down=null;if(longPress!==null)win.clearTimeout(longPress);longPress=null;});
  listen('click',e=>{if(internal((e.target as Element)))return;if(suppressClick){suppressClick=false;e.preventDefault();e.stopPropagation();return;}if(active()){const n=element(e);e.preventDefault();e.stopPropagation();if(n)emit(n);}});
  listen('contextmenu',e=>{const n=element(e);if(!state?.enabled||!state.canComment||!n)return;e.preventDefault();const p=e as MouseEvent;showAction(p.clientX,p.clientY,()=>emit(n),true);});
  listen('selectionchange',()=>{
    if(!state?.enabled||!state.canComment||active())return;
    const s=win.getSelection();if(!s||s.isCollapsed||!s.rangeCount){clearAction();return;}
    const r=s.getRangeAt(0),n=r.commonAncestorContainer,node=n.nodeType===1?n as Element:n.parentElement;
    if(!node||!eligible(node))return;
    const quote=canonical(s.toString()).slice(0,2000);if(!quote)return;
    const before=r.cloneRange();before.selectNodeContents(node);before.setEnd(r.startContainer,r.startOffset);
    const start=canonical(before.toString()).length;const full=canonical(node.textContent??'');const at=full.indexOf(quote,Math.max(0,start-1));
    const range:ManagedCommentSelection['range']={v:1,parts:[{rel:'',start:Math.max(0,at),end:Math.max(0,at)+quote.length,text:quote}]};
    const box=r.getBoundingClientRect?.()??rect(node);showAction(box.x,box.y+box.height+4,()=>emit(node,range,quote),true);
  });
  listen('keydown',e=>{if((e as KeyboardEvent).key==='Escape'){clearAction();if(state){state={...state,selection:null};send({type:'comment-selection',generation:state.generation,selection:null});repaint();}}});
  listen('scroll',schedule);win.addEventListener('resize',schedule);listeners.push(()=>win.removeEventListener('resize',schedule));
  const observer=new MutationObserver(records=>{if(records.some(r=>!marks.includes(r.attributeName??'')&&!(r.target.nodeType===1&&internal(r.target as Element))))schedule();});
  observer.observe(doc.body,{childList:true,subtree:true,characterData:true,attributes:true});
  const resize=typeof ResizeObserver!=='undefined'?new ResizeObserver(schedule):null;resize?.observe(doc.body);
  return {
    update(next){if(disposed)return;state=next;if(!next.enabled||!next.picking)hovered=null;if(!next.enabled)clearAction();repaint();},
    dispose(){if(disposed)return;disposed=true;clearMarks();for(const stop of listeners)stop();observer.disconnect();resize?.disconnect();if(timer!==null)win.clearTimeout(timer);if(longPress!==null)win.clearTimeout(longPress);overlay?.remove();clearAction();}
  };
}
