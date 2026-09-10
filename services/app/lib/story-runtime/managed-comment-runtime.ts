import type { CommentPresentation } from './comment-presentation';
import type { ManagedCommentEvent, ManagedCommentState, ManagedCommentSelection } from './managed-comment-contract';
import type { IframeNodeTarget } from '@/lib/story/comment-target';
import type { AnnotationRect } from '@/lib/story/annotation-range';

/** Self-contained child-realm installer. Keep all runtime dependencies inside this function:
 * its source is embedded in the opaque frame's classic bootstrap, never executed in the host. */
export function createManagedCommentRuntime(win: Window, send: (message: ManagedCommentEvent) => void, presentation: CommentPresentation): {
  update(state: ManagedCommentState): void;
  dispose(): void;
} {
  const doc = win.document;
  const style=doc.createElement('style');style.setAttribute('data-mx-comment-ui','');
  style.textContent=presentation.actionsCss+'\n'+presentation.annotationCss;doc.head.append(style);
  let state: ManagedCommentState | null = null;
  let disposed = false;
  const sourceIds=new Set(Array.from(doc.body.querySelectorAll('[id]')).map(node=>node.id));
  let savedStyles:Array<{node:HTMLElement;name:string;value:string;priority:string}>|null=null;
  const touchMode=(enabled:boolean)=>{
    if(enabled&&!savedStyles){
      // Chromium aliases -webkit-user-select to user-select. Snapshot ALL values
      // before setting either spelling, or the second snapshot records our own
      // 'none' and leaves text permanently unselectable after the first comment.
      savedStyles=[doc.documentElement,doc.body].flatMap(node=>['touch-action','user-select','-webkit-user-select'].map(name=>({node,name,value:node.style.getPropertyValue(name),priority:node.style.getPropertyPriority(name)})));
      for(const {node,name} of savedStyles)node.style.setProperty(name,'none','important');
    }else if(!enabled&&savedStyles){for(const {node,name,value,priority} of savedStyles){if(value)node.style.setProperty(name,value,priority);else node.style.removeProperty(name);}savedStyles=null;}
  };
  let sequence = 0;
  const sessions = new WeakMap<Element, string>();
  const listeners: Array<() => void> = [];
  let timer: number | null = null;
  let longPress: number | null = null;
  let down: {x:number;y:number;node:Element} | null = null;
  let suppressClick = false;
  let hovered: Element | null = null;
  let action: HTMLElement | null = null;
  let contextOpen = false;
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
      if (path.length && path.length <= 16 && path.every(k => k.length <= 256)) return {kind:'key',path};
    }
    if (el.id && sourceIds.has(el.id)) return {kind:'source',id:el.id};
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
  const clearAction = () => { action?.remove(); action=null; contextOpen=false; };
  const layer = () => {
    if(!overlay?.isConnected) {
      overlay=doc.createElement('div');overlay.setAttribute('data-mx-comment-ui','');
      overlay.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
      doc.documentElement.append(overlay);
    }
    return overlay;
  };
  const draw = (r:AnnotationRect, paint:{background:string;outline?:string}, attr?:string) => {
    const box=doc.createElement('div');
    box.style.cssText=`position:absolute;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;box-sizing:border-box;border-radius:3px;pointer-events:none;`;
    box.style.background=paint.background;if(paint.outline)box.style.outline=paint.outline;
    if(attr)box.setAttribute(attr,'');layer().append(box);
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
        text=text.trimEnd();const at=text.indexOf(part.text);
        // A repeated quote cannot be disambiguated by a stale positional hint.
        if(at<0 || text.indexOf(part.text,at+1)>=0) continue;
        const locate=(offset:number):[Text,number]|null=>{for(const n of nodes){if(offset<=n.length)return[n,offset];offset-=n.length;}return null;};
        const a=locate(offsets[at]),b=locate(offsets[at+part.text.length-1]+1);
        if(a&&b){const domRange=doc.createRange();domRange.setStart(...a);domRange.setEnd(...b);if(domRange.getClientRects)for(const q of domRange.getClientRects())out.push({x:q.x,y:q.y,width:q.width,height:q.height});}
      }
      return out;
    }
    return [r];
  };
  const marks=['data-mx-annotated','data-mx-annotation-open','data-mx-annotation-hover','data-mx-annotate-selected','data-mx-annotate-pick-hover','data-mx-annotation-ranged'];
  const marked=new Set<Element>();
  const mark=(node:Element,name:string)=>{node.setAttribute(name,'');marked.add(node);};
  const clearMarks=()=>{for(const node of marked)for(const name of marks)node.removeAttribute(name);marked.clear();};
  const repaint = () => {
    if(disposed||!state)return;
    overlay?.replaceChildren();clearMarks();touchMode(state.enabled&&state.picking&&state.canComment);
    doc.documentElement.removeAttribute('data-mx-annotate-picking');
    if(state.enabled&&(state.picking||state.blockPicking))doc.documentElement.setAttribute('data-mx-annotate-picking',state.picking?'select':'block');
    if(!state.enabled) {overlay?.remove();return;}
    const positions:Extract<ManagedCommentEvent,{type:'comment-layout'}>['positions']=[];
    for(const pin of state.pins) {
      const found=resolve(pin.target);let r:AnnotationRect={x:0,y:0,width:0,height:0};
      if(found.node){
        mark(found.node,'data-mx-annotated');if(state.openId===pin.id)mark(found.node,'data-mx-annotation-open');if(state.hoverId===pin.id)mark(found.node,'data-mx-annotation-hover');
        if(state.openId===pin.id && (lastOpen!==pin.id || revealed!==found.node)) {found.node.scrollIntoView?.({block:'nearest',inline:'nearest'});revealed=found.node;}
        const rs=rangeRects(found.node,pin.range??undefined);r=rs[0]??rect(found.node);
        const active=state.openId===pin.id?'open':state.hoverId===pin.id?'hover':'base';
        if(pin.range?.kind==='area') {
          for(const box of rs)draw(box,presentation.areaFill[active],'data-mx-annotation-area');
        } else if(pin.range && rs.length) {
          mark(found.node,'data-mx-annotation-ranged');
          for(const box of rs)draw(box,{background:presentation.highlightFill[active]});
        }

      }
      positions.push({id:pin.id,rect:r,status:found.status});
    }
    lastOpen=state.openId;if(!lastOpen)revealed=null;
    let selectionRect:AnnotationRect|null=null;
    if(state.selection){const found=resolve(state.selection.target);if(found.node){
      mark(found.node,'data-mx-annotate-selected');selectionRect=rangeRects(found.node,state.selection.range)[0]??rect(found.node);
      if(state.selection.range?.kind==='area')draw(selectionRect,{background:presentation.bandStyle.background,outline:'1px dashed '+presentation.bandStyle.outline},'data-mx-annotate-band');
    }}
    if((state.picking||state.blockPicking)&&hovered?.isConnected)mark(hovered,'data-mx-annotate-pick-hover');
    send({type:'comment-layout',generation:state.generation,positions,selectionRect,selectionTarget:state.selection?.target??null});
  };

  const schedule = () => {if(timer===null&&!disposed)timer=win.setTimeout(()=>{timer=null;repaint();},32);};
  const emit = (node:Element, range?:ManagedCommentSelection['range'],quote?:string) => {
    if(!state?.enabled||!state.canComment)return;
    const selection={target:target(node),rect:rangeRects(node,range)[0]??rect(node),...(range?{range}:{}),...(quote?{quote}:{})};
    state={...state,selection};clearAction();send({type:'comment-selection',generation:state.generation,selection});repaint();
  };
  const element = (e:Event) => {const n=e.target as Node|null;const el=n?.nodeType===1?n as Element:n?.parentElement;return el&&eligible(el)?el:null;};
  const active = () => !!(state?.enabled&&state.canComment&&state.picking);
  const listen = (name:string,handler:(event:Event)=>void) => {doc.addEventListener(name,handler,true);listeners.push(()=>doc.removeEventListener(name,handler,true));};
  const showAction = (x:number,y:number,select:()=>void,withComment:boolean) => {
    clearAction();contextOpen=!withComment;action=doc.createElement('div');action.setAttribute('data-mx-comment-ui','');
    action.setAttribute('data-mx-selection-actions','');action.setAttribute('role','toolbar');
    action.setAttribute('aria-label',withComment?'Text selection actions':'Document actions');
    const coarse=win.matchMedia?.('(pointer: coarse)')?.matches===true;
    action.addEventListener('pointerdown',e=>e.preventDefault());
    const button=(kind:'annotate'|'select',fn:()=>void)=>{
      const b=doc.createElement('button');b.type='button';b.setAttribute('data-mx-selection-action',kind);
      b.setAttribute('aria-label',kind==='select'?'Select':'Comment on selected text');
      if(coarse)b.className='mx-selection-action--coarse';
      const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');
      for(const [name,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',class:'lucide lucide-'+(kind==='select'?'square-dashed-mouse-pointer':'message-square')}))svg.setAttribute(name,value);
      for(const d of presentation.icons[kind]){const path=doc.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',d);svg.append(path);}
      b.append(svg,doc.createTextNode(kind==='select'?'Select':'comment'));
      b.onclick=e=>{e.preventDefault();e.stopPropagation();fn();clearAction();};action!.append(b);
    };
    if(withComment)button('annotate',select);
    button('select',()=>{win.getSelection()?.removeAllRanges();send({type:'comment-select-mode',generation:state!.generation});state={...state!,picking:true,blockPicking:false,selection:null};repaint();});
    doc.documentElement.append(action);
    const bounds=action.getBoundingClientRect();
    action.style.left=Math.max(8,Math.min(x,win.innerWidth-bounds.width-8))+'px';
    action.style.top=Math.max(8,Math.min(y,win.innerHeight-bounds.height-8))+'px';
  };
  const selecting = () => !!(state?.enabled&&state.canComment&&(state.picking||state.blockPicking));
  const draggedWords = () => {const selection=win.getSelection();return !!selection&&!selection.isCollapsed&&!!selection.toString();};
  const pinAt = (node:Element|null) => {for(let el=node;el;el=el.parentElement){const pin=state?.pins.find(pin=>resolve(pin.target).node===el);if(pin)return pin;}return null;};
  const leave=(e:Event)=>{if(!(e as MouseEvent).relatedTarget){hovered=null;if(state?.enabled)send({type:'comment-hover',generation:state.generation,id:null});schedule();}};
  listen('mouseout',leave);listen('pointerout',leave);
  listen('mouseover',e=>{if(selecting()){hovered=element(e);schedule();}else if(state?.enabled){send({type:'comment-hover',generation:state.generation,id:pinAt(element(e))?.id??null});}});
  listen('pointerdown',e=>{
    const p=e as PointerEvent,n=element(e);if(!n||p.button>0)return;
    clearAction();down={x:p.clientX,y:p.clientY,node:n};
    if(active()){e.preventDefault();e.stopPropagation();}
    else if(state?.enabled&&state.canComment&&p.pointerType==='touch')longPress=win.setTimeout(()=>{longPress=null;suppressClick=true;showAction(p.clientX,p.clientY,()=>emit(n),false);},550);
  });
  listen('pointermove',e=>{const p=e as PointerEvent;if(down&&(Math.abs(p.clientX-down.x)>6||Math.abs(p.clientY-down.y)>6)){if(longPress!==null){win.clearTimeout(longPress);longPress=null;}if(active()){overlay?.replaceChildren();draw({x:Math.min(p.clientX,down.x),y:Math.min(p.clientY,down.y),width:Math.abs(p.clientX-down.x),height:Math.abs(p.clientY-down.y)},{background:presentation.bandStyle.background,outline:'1px dashed '+presentation.bandStyle.outline},'data-mx-annotate-band');}}});
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
  listen('pointercancel',()=>{down=null;hovered=null;schedule();if(longPress!==null)win.clearTimeout(longPress);longPress=null;});
  listen('click',e=>{
    const node=element(e);if(!node)return;
    if(suppressClick){suppressClick=false;e.preventDefault();e.stopPropagation();return;}
    if(draggedWords()&&!active())return;
    if(selecting()){e.preventDefault();e.stopPropagation();emit(node);return;}
    // Existing threads open from parent markers; content clicks remain native.
  });
  listen('contextmenu',e=>{const n=element(e);if(!state?.enabled||!state.canComment||!n)return;e.preventDefault();const p=e as MouseEvent;showAction(p.clientX,p.clientY,()=>emit(n),false);});
  const showTextActions=(event?:Event)=>{
    if(contextOpen)return;
    if(event?.target && (event.target as Node).nodeType===1 && internal(event.target as Element))return;
    if(!state?.enabled||!state.canComment||active())return;
    const s=win.getSelection();if(!s||s.isCollapsed||!s.rangeCount){clearAction();return;}
    let r=s.getRangeAt(0);const n=r.commonAncestorContainer;
    let node=n.nodeType===1?n as Element:n.parentElement;
    // Native line/paragraph selections may end at offset zero of the following
    // element. Keep the block that owns all selected words, like markup does.
    const startElement=r.startContainer.nodeType===1?r.startContainer as Element:r.startContainer.parentElement;
    const block=startElement?.closest('p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,figcaption,dd,dt,pre');
    if(block&&!block.contains(r.endContainer)){
      const clipped=r.cloneRange();clipped.setEnd(block,block.childNodes.length);
      if(canonical(clipped.toString())===canonical(s.toString())){node=block;r=clipped;}
    }
    if(!node||!eligible(node))return;
    const quote=canonical(s.toString()).slice(0,2000);if(!quote)return;
    const before=r.cloneRange();before.selectNodeContents(node);before.setEnd(r.startContainer,r.startOffset);
    const start=canonical(before.toString()).length;const full=canonical(node.textContent??'');const at=full.indexOf(quote,Math.max(0,start-1));
    const range:ManagedCommentSelection['range']={v:1,parts:[{rel:'',start:Math.max(0,at),end:Math.max(0,at)+quote.length,text:quote}]};
    const box=r.getBoundingClientRect?.()??rect(node);showAction(box.x,win.matchMedia?.('(pointer: coarse)')?.matches?box.y+box.height+8:box.y-36,()=>emit(node,range,quote),true);
  };
  listen('selectionchange',showTextActions);
  listen('mouseup',showTextActions);
  listen('keyup',e=>{if((e as KeyboardEvent).key==='Shift'||(e as KeyboardEvent).shiftKey)showTextActions();});
  listen('keydown',e=>{if((e as KeyboardEvent).key==='Escape'){clearAction();if(state){state={...state,picking:false,blockPicking:false,selection:null};send({type:'comment-selection',generation:state.generation,selection:null});repaint();}}});
  listen('scroll',schedule);win.addEventListener('resize',schedule);listeners.push(()=>win.removeEventListener('resize',schedule));
  const observer=new MutationObserver(records=>{if(records.some(r=>!marks.includes(r.attributeName??'')&&!(r.target.nodeType===1&&internal(r.target as Element))))schedule();});
  observer.observe(doc.body,{childList:true,subtree:true,characterData:true,attributes:true});
  const resize=typeof ResizeObserver!=='undefined'?new ResizeObserver(schedule):null;resize?.observe(doc.body);
  return {
    update(next){if(disposed)return;if(next.picking&&!state?.picking){win.getSelection()?.removeAllRanges();clearAction();}state=next;if(!next.enabled||(!next.picking&&!next.blockPicking))hovered=null;if(!next.picking){down=null;suppressClick=false;}if(!next.enabled)clearAction();repaint();},
    dispose(){if(disposed)return;disposed=true;touchMode(false);clearMarks();style.remove();doc.documentElement.removeAttribute('data-mx-annotate-picking');for(const stop of listeners)stop();observer.disconnect();resize?.disconnect();if(timer!==null)win.clearTimeout(timer);if(longPress!==null)win.clearTimeout(longPress);overlay?.remove();clearAction();}
  };
}
