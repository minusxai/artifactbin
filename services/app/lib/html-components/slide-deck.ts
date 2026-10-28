/**
 * <af-slide-deck>: keyboard-navigable deck of af-slide children with presentation and print behaviour. Its slides are not export-marked: for slide images use your own data-af-slide sections.
 * Import:  import '@afbin/slide-deck';  (registers the tags; this .ts is the readable contract)
 * Props: index (zero-based; you own it)
 * Events: af-change (bubbles) with event.detail.value; reflect your Apollo value back for controlled use
 * Slide IDs stay stable when reordered or edited. Check keyboard navigation and print layout in the actual page.
 * Usage:
 *   <script type="application/json" data-af="state">{"index":0}</script>
 *   <af-slide-deck data-af-id="quarterly-deck" index="0"><af-slide data-af-id="quarterly-intro"><h1>Review</h1></af-slide>
 *   <af-slide data-af-id="quarterly-next"><h2>Next</h2></af-slide></af-slide-deck>
 *   import {client,gql} from "@afbin/apollo"; import "@afbin/slide-deck";
 *   const deck=document.querySelector("af-slide-deck"), q=gql`{index}`;
 *   const sub=client.watchQuery({query:q}).subscribe(({data})=>{if(deck.index!==data.index)deck.index=data.index;});
 *   deck.addEventListener("af-change",e=>client.updateQuery({query:q},s=>({...s,index:e.detail.value})));
 *   window.addEventListener("pagehide",()=>sub.unsubscribe(),{once:true});
 */
import { registerComponent } from './register-component';
import { slideIndex, slideKeyIndex, visibleSlideIndex, type SlideDeckChangeDetail, type SlideDeckContract } from './slide-navigation';

let sequence=0;
const previewSvgTags=new Set(['svg','g','path','rect','circle','ellipse','line','polyline','polygon','text','tspan']);
const previewSvgAttributes=['viewBox','d','points','x','y','x1','x2','y1','y2','width','height','cx','cy','r','rx','ry','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','transform','opacity','font-size','font-weight','text-anchor','preserveAspectRatio'];
const numberAttribute=(element:Element,name:string,fallback:number):number=>{const raw=element.getAttribute(name);return raw===null||raw.trim()===''?fallback:Number(raw);};
const previewTags=new Set(['div','section','article','p','h1','h2','h3','h4','h5','h6','span','strong','em','ul','ol','li','dl','dt','dd','table','thead','tbody','tr','th','td','blockquote','pre','code','br','hr']);
const previewProperties=['display','flex-direction','flex-wrap','align-items','justify-content','gap','grid-template-columns','padding','margin','color','background-color','font-size','font-weight','line-height','text-align','border','border-radius','width','height','max-width','min-height'];
/** Rebuild only passive HTML: no custom element upgrade, copied identity, event attribute, URL or nested control. */
function previewNode(source:Node,doc:Document):Node {
  if(source.nodeType===3)return doc.createTextNode(source.textContent??'');
  if(!(source instanceof Element))return doc.createTextNode('');
  if(['script','style','link','iframe','object','embed','audio','video','source','template'].includes(source.localName))return doc.createTextNode('');
  if(source.localName==='img')return doc.createTextNode(source.getAttribute('alt')??'');
  if(source instanceof HTMLInputElement || source instanceof HTMLTextAreaElement || source instanceof HTMLSelectElement)return doc.createTextNode(source.value);
  if(source.namespaceURI==='http://www.w3.org/2000/svg'){
    if(!previewSvgTags.has(source.localName))return doc.createTextNode('');
    const node=doc.createElementNS('http://www.w3.org/2000/svg',source.localName);
    for(const attribute of previewSvgAttributes){const value=source.getAttribute(attribute);if(value!==null&&!/url\s*\(|javascript:|https?:|data:/i.test(value))node.setAttribute(attribute,value);}
    for(const child of source.childNodes)node.append(previewNode(child,doc));return node;
  }
  const node=doc.createElement(previewTags.has(source.localName)?source.localName:'div');
  // CSS classes may be used by authored design systems; URL-bearing attributes and inline URL paints are never copied.
  if(source.hasAttribute('class'))node.className=source.getAttribute('class')!;
  if(source instanceof HTMLElement)for(const property of previewProperties){const value=source.style.getPropertyValue(property);if(value && !/url\s*\(|var\s*\(/i.test(value))node.style.setProperty(property,value);}
  if(source.localName==='af-slide')node.setAttribute('data-af-preview-slide','');
  for(const child of source.childNodes)node.append(previewNode(child,doc));
  return node;
}

/** Continuous authored slides with scoped rail/chrome; selection intent is author-owned, never persisted. */
export class AfSlideDeck extends HTMLElement implements SlideDeckContract {
  static observedAttributes=['index','label'];
  private selection=0;
  private supplied:number|undefined;
  private initialized=false;
  private activeSlide:HTMLElement|undefined;
  private rail:HTMLElement|undefined;
  private toolbar:HTMLElement|undefined;
  private count:HTMLOutputElement|undefined;
  private previous:HTMLButtonElement|undefined;
  private next:HTMLButtonElement|undefined;
  private present:HTMLButtonElement|undefined;
  private status:HTMLElement|undefined;
  private rows=new WeakMap<HTMLElement,HTMLButtonElement>();
  private observer=new MutationObserver(records=>{if(records.some(record=>this.isAuthoredMutation(record)))this.sync();});
  private focusBeforePresentation:HTMLElement|null=null;
  private presenting=false;
  private pendingPresentation=false;
  private frame:number|undefined;
  private connection=0;
  get index():number {return slideIndex(this.supplied??(this.hasAttribute('index')?numberAttribute(this,'index',0):this.selection),this.slides().length);}
  set index(index:number|undefined){if(index===undefined)this.selection=this.index;this.supplied=index;this.sync(true);}
  connectedCallback():void {
    this.connection++;
    if(Object.prototype.hasOwnProperty.call(this,'index')){const index=this.index;delete (this as {index?:number}).index;this.index=index;}
    if(!this.initialized){this.selection=numberAttribute(this,'default-index',0);this.initialized=true;}
    if(!this.hasAttribute('tabindex'))this.tabIndex=0;
    if(!this.hasAttribute('role'))this.setAttribute('role','region');
    this.setAttribute('aria-roledescription','slide deck');
    this.ensureChrome();this.sync();
    this.addEventListener('click',this.clickControl);
    this.ownerDocument.addEventListener('keydown',this.keydown);
    this.ownerDocument.addEventListener('focusin',this.paintToolbar);
    this.ownerDocument.addEventListener('fullscreenchange',this.fullscreenChange);
    this.ownerDocument.defaultView?.addEventListener('scroll',this.onScroll,{passive:true});
    this.ownerDocument.defaultView?.addEventListener('resize',this.onScroll);
    this.observer.observe(this,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['title','id','label']});
    this.frame=this.ownerDocument.defaultView?.requestAnimationFrame(()=>{this.frame=undefined;if(this.index>0)this.scrollToIndex();});
  }
  disconnectedCallback():void {
    this.connection++;
    this.observer.disconnect();this.removeEventListener('click',this.clickControl);
    this.ownerDocument.removeEventListener('keydown',this.keydown);this.ownerDocument.removeEventListener('focusin',this.paintToolbar);this.ownerDocument.removeEventListener('fullscreenchange',this.fullscreenChange);
    this.ownerDocument.defaultView?.removeEventListener('scroll',this.onScroll);this.ownerDocument.defaultView?.removeEventListener('resize',this.onScroll);
    if(this.frame!==undefined)this.ownerDocument.defaultView?.cancelAnimationFrame(this.frame);this.frame=undefined;
    this.focusBeforePresentation=null;
    if(this.ownerDocument.fullscreenElement===this)void this.ownerDocument.exitFullscreen?.().catch(()=>{});
    this.presenting=false;
  }
  attributeChangedCallback(name:string):void {this.sync(name==='index');}
  private slides():HTMLElement[]{return [...this.querySelectorAll<HTMLElement>('af-slide')].filter(slide=>slide.closest('af-slide-deck')===this);}
  private controlled():boolean{return this.supplied!==undefined || this.hasAttribute('index');}
  private isAuthoredMutation(record:MutationRecord):boolean {
    const target=record.target instanceof Element?record.target:record.target.parentElement;
    if(target?.closest('[data-af-deck-chrome]'))return false;
    if(record.type==='childList' && target===this)return [...record.addedNodes,...record.removedNodes].some(node=>!(node instanceof Element && node.hasAttribute('data-af-deck-chrome')));
    return true;
  }
  private ensureChrome():void {
    if(this.rail)return;
    const doc=this.ownerDocument;
    this.rail=doc.createElement('nav');this.rail.setAttribute('aria-label','Slides');this.rail.dataset.afDeckChrome='rail';
    this.toolbar=doc.createElement('div');this.toolbar.dataset.afDeckChrome='toolbar';this.toolbar.setAttribute('role','group');this.toolbar.setAttribute('aria-label','Slide controls');
    const button=(label:string,text:string)=>{const node=doc.createElement('button');node.type='button';node.setAttribute('aria-label',label);node.textContent=text;return node;};
    this.previous=button('Previous slide','‹');this.next=button('Next slide','›');this.present=button('Present','present');
    this.count=doc.createElement('output');this.count.dataset.afDeckCount='';this.count.setAttribute('aria-label','Slide count');
    this.toolbar.append(this.previous,this.count,this.next,this.present);
    this.status=doc.createElement('span');this.status.setAttribute('role','status');this.status.dataset.afDeckChrome='status';
    this.prepend(this.rail);this.append(this.toolbar,this.status);
  }
  private slideTitle(slide:HTMLElement,index:number):string{return slide.getAttribute('title')??slide.querySelector('h1,h2,h3')?.textContent?.trim()??`Slide ${index+1}`;}
  private sync(scroll=false):void {
    if(!this.isConnected || !this.rail)return;
    const slides=this.slides();
    if(!this.controlled() && this.activeSlide && slides.includes(this.activeSlide))this.selection=slides.indexOf(this.activeSlide);
    if(!this.controlled())this.selection=slideIndex(this.selection,slides.length);
    const index=this.index;this.activeSlide=slides[index];
    this.setAttribute('aria-label',this.getAttribute('label')??'Slide deck');
    this.style.setProperty('--af-deck-slide-count',String(Math.max(1,slides.length)));
    const retained=new Set(slides.map(slide=>this.rows.get(slide)));
    for(const row of [...this.rail.children])if(!retained.has(row as HTMLButtonElement))row.remove();
    const keep=new Set<HTMLButtonElement>();
    slides.forEach((slide,i)=>{
      if(!slide.id){let id:string;do{id=`af-slide-${++sequence}`;}while(this.ownerDocument.getElementById(id));slide.id=id;}
      let row=this.rows.get(slide);
      if(!row){row=this.ownerDocument.createElement('button');row.type='button';row.dataset.afDeckRow='';this.rows.set(slide,row);}
      row.dataset.index=String(i);row.setAttribute('aria-label',`Go to slide ${i+1}: ${this.slideTitle(slide,i)}`);row.setAttribute('aria-controls',slide.id);row.setAttribute('aria-current',String(i===index));
      const label=this.ownerDocument.createElement('span');label.dataset.afDeckLabel='';const number=this.ownerDocument.createElement('span');number.dataset.afDeckIndex='';number.textContent=String(i+1);
      const title=this.ownerDocument.createElement('span');title.dataset.afDeckTitle='';title.textContent=this.slideTitle(slide,i);label.append(number,title);
      const preview=this.ownerDocument.createElement('span');preview.dataset.afDeckPreview='';preview.setAttribute('inert','');preview.setAttribute('aria-hidden','true');
      const miniature=this.ownerDocument.createElement('div');miniature.append(previewNode(slide,this.ownerDocument));preview.append(miniature);
      row.replaceChildren(label,preview);keep.add(row);const at=this.rail!.children[i];if(at!==row)this.rail!.insertBefore(row,at??null);
    });
    for(const row of this.rail.children)if(!keep.has(row as HTMLButtonElement))row.remove();
    this.count!.textContent=`${slides.length?index+1:0} / ${slides.length}`;
    // The reader keeps both paging controls available at the ends. Requests
    // are clamped by slideIndex, so a boundary click is a harmless no-op and
    // never wraps around the deck.
    this.previous!.disabled=index<0;this.next!.disabled=index<0;this.present!.disabled=slides.length===0||this.pendingPresentation;
    this.paintPresentation();this.toolbar!.hidden=this.documentDeck()!==this;
    if(scroll)this.scrollToIndex();
  }
  private scrollToIndex():void {this.slides()[this.index]?.scrollIntoView?.({behavior:this.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});}
  private request(index:number,scroll:boolean):void {
    const next=slideIndex(index,this.slides().length);if(next<0||next===this.index)return;
    const intent=new CustomEvent<SlideDeckChangeDetail>('af-change',{detail:{value:next},bubbles:true,composed:true,cancelable:true});
    if(!this.dispatchEvent(intent))return;
    if(!this.controlled()){this.selection=next;this.activeSlide=this.slides()[next];this.sync(scroll);}
  }
  private clickControl=(event:MouseEvent):void=>{
    if(event.defaultPrevented || !(event.target instanceof Element) || event.target.closest('af-slide-deck')!==this)return;
    const button=event.target.closest<HTMLButtonElement>('button');if(!button||button.disabled)return;
    if(button===this.previous)this.request(this.index-1,true);
    else if(button===this.next)this.request(this.index+1,true);
    else if(button===this.present)void this.toggleFullscreen();
    else if(button.closest('nav')===this.rail)this.request(Number(button.dataset.index),true);
  };
  private documentDeck():AfSlideDeck|undefined {
    const doc=this.ownerDocument;
    if(doc.fullscreenElement instanceof AfSlideDeck)return doc.fullscreenElement;
    const focused=doc.activeElement?.closest<AfSlideDeck>('af-slide-deck');if(focused)return focused;
    const decks=[...doc.querySelectorAll<AfSlideDeck>('af-slide-deck')].filter(deck=>!deck.parentElement?.closest('af-slide-deck'));
    const mark=(doc.defaultView?.innerHeight??0)/3;
    return decks.find(deck=>{const rect=deck.getBoundingClientRect();return rect.top<=mark&&rect.bottom>mark;})??decks.find(deck=>deck.getBoundingClientRect().bottom>0)??(decks.length===1?decks[0]:undefined);
  }
  private keydown=(event:KeyboardEvent):void=>{
    if(event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
    const target=event.target instanceof Element?event.target:null;
    if(target?.closest('input,textarea,select,button,a[href],[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="slider"],[role="switch"]'))return;
    const owner=target?.closest('af-slide-deck')??this.documentDeck();if(owner!==this)return;
    const next=slideKeyIndex(event.key,this.index,this.slides().length);if(next===null||next<0)return;
    event.preventDefault();this.request(next,true);
  };
  private paintToolbar=():void=>{if(this.toolbar)this.toolbar.hidden=this.documentDeck()!==this;};
  private onScroll=():void=>{
    this.toolbar && (this.toolbar.hidden=this.documentDeck()!==this);
    const mark=(this.ownerDocument.defaultView?.innerHeight??0)/3;
    this.request(visibleSlideIndex(this.slides().map(slide=>slide.getBoundingClientRect().top),mark),false);
  };
  private paintPresentation():void {
    if(!this.present)return;
    const full=this.ownerDocument.fullscreenElement===this;
    this.present.setAttribute('aria-label',full?'Exit presentation':'Present');this.present.textContent=full?'exit':'present';
  }
  private fullscreenChange=():void=>{
    const full=this.ownerDocument.fullscreenElement===this;this.paintPresentation();
    if(this.presenting&&!full&&!this.pendingPresentation)this.restoreFocus();
    this.presenting=full;
  };
  private restoreFocus():void {if(this.focusBeforePresentation?.isConnected)this.focusBeforePresentation.focus();this.focusBeforePresentation=null;}
  private async toggleFullscreen():Promise<void> {
    if(this.pendingPresentation)return;
    const connection=this.connection;
    // A native disabled button can blur immediately; save the opener while it is still focusable.
    if(this.ownerDocument.fullscreenElement!==this)this.focusBeforePresentation=this.ownerDocument.activeElement as HTMLElement|null;
    this.pendingPresentation=true;this.present!.disabled=true;this.status!.textContent='';
    try {
      if(this.ownerDocument.fullscreenElement===this)await this.ownerDocument.exitFullscreen();
      else {if(!this.requestFullscreen)throw new Error('unavailable');await this.requestFullscreen();}
      if(connection!==this.connection && this.ownerDocument.fullscreenElement===this)await this.ownerDocument.exitFullscreen();
    } catch {if(this.isConnected)this.status!.textContent='Presentation unavailable';}
    finally {this.pendingPresentation=false;if(this.isConnected){this.present!.disabled=this.slides().length===0;this.paintPresentation();if(this.ownerDocument.fullscreenElement!==this)this.restoreFocus();}}
  }
}

class AfSlide extends HTMLElement {
  static observedAttributes=['title'];
  private generatedLabel:string|undefined;
  connectedCallback():void {if(!this.hasAttribute('role'))this.setAttribute('role','group');if(!this.hasAttribute('aria-roledescription'))this.setAttribute('aria-roledescription','slide');this.labelSlide();}
  attributeChangedCallback():void {this.labelSlide();}
  private labelSlide():void {
    if(this.hasAttribute('aria-label') && this.getAttribute('aria-label')!==this.generatedLabel)return;
    const title=this.getAttribute('title');
    if(title!==null){this.setAttribute('aria-label',title);this.generatedLabel=title;}
    else {this.removeAttribute('aria-label');this.generatedLabel=undefined;}
  }
}

const slideDeckStyles=`
af-slide-deck{display:grid;grid-template-columns:190px minmax(0,1fr);align-items:start;position:relative;width:100%;min-width:0;color:var(--foreground,CanvasText);background:var(--background,Canvas)}
/* Slides own composition; an authored content wrapper owns the column gutter. */
af-slide{display:flex;position:relative;box-sizing:border-box;flex-direction:column;width:100%;min-width:0;min-height:var(--af-slide-height,100svh);padding:0;overflow-wrap:anywhere;scroll-margin-top:0}
af-slide>h1:first-child,af-slide>h2:first-child,af-slide>h3:first-child,af-slide>h4:first-child,af-slide>h5:first-child,af-slide>h6:first-child{margin-top:0}
af-slide :is(h1,h2,h3,h4,h5,h6){font-family:var(--font-display,inherit);font-size:clamp(2rem,5vw,2.5rem);font-weight:600;line-height:1.2}
af-slide :is(h1,h2,h3,h4,h5,h6):not([class]){margin-block:1.6em .5em}
af-slide h1:not([class]){margin-block-start:0}
af-slide :is(p,ul,ol,blockquote,table,pre):not([class]){margin-block:.75em;max-width:68ch;line-height:1.65}
af-slide-deck [data-af-deck-preview] [data-af-preview-slide]{display:flex;position:relative;box-sizing:border-box;flex-direction:column;width:100%;min-width:0;min-height:100%;padding:0;overflow-wrap:anywhere}
af-slide-deck [data-af-deck-preview] [data-af-preview-slide]>h1:first-child,af-slide-deck [data-af-deck-preview] [data-af-preview-slide]>h2:first-child,af-slide-deck [data-af-deck-preview] [data-af-preview-slide]>h3:first-child,af-slide-deck [data-af-deck-preview] [data-af-preview-slide]>h4:first-child,af-slide-deck [data-af-deck-preview] [data-af-preview-slide]>h5:first-child,af-slide-deck [data-af-deck-preview] [data-af-preview-slide]>h6:first-child{margin-top:0}
af-slide-deck [data-af-deck-preview] [data-af-preview-slide] :is(h1,h2,h3,h4,h5,h6){font-family:var(--font-display,inherit);font-size:clamp(2rem,5vw,2.5rem);font-weight:600;line-height:1.2}
af-slide-deck [data-af-preview-slide] :is(h1,h2,h3,h4,h5,h6):not([class]){margin-block:1.6em .5em}
af-slide-deck [data-af-preview-slide] h1:not([class]){margin-block-start:0}
af-slide-deck [data-af-preview-slide] :is(p,ul,ol,blockquote,table,pre):not([class]){margin-block:.75em;max-width:68ch;line-height:1.65}
af-slide-deck>af-slide{grid-column:2}
af-slide-deck>[data-af-deck-chrome=rail]{grid-column:1;grid-row:1/span var(--af-deck-slide-count,1);position:sticky;top:0;width:190px;height:100vh;overflow:auto;box-sizing:border-box;padding:12px 10px;border-right:1px solid var(--border,#8884);background:var(--background,Canvas);font-family:ui-sans-serif,system-ui,sans-serif}
af-slide-deck [data-af-deck-row]{display:block;width:100%;text-align:left;cursor:pointer;margin:0 0 8px;padding:6px;border:1px solid transparent;border-radius:6px;background:none;color:inherit;font:inherit}
af-slide-deck [data-af-deck-row][aria-current=true]{border-color:var(--border,#8888);background:color-mix(in srgb,var(--foreground,gray) 12%,transparent)}
af-slide-deck [data-af-deck-label]{display:flex;gap:6px;align-items:baseline;font-size:11px;line-height:1.3}
af-slide-deck [data-af-deck-index]{color:var(--muted-foreground,gray);font-variant-numeric:tabular-nums}
af-slide-deck [data-af-deck-title]{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
af-slide-deck [data-af-deck-preview]{display:block;position:relative;box-sizing:border-box;width:100%;aspect-ratio:16/10;margin-top:4px;overflow:hidden;border:1px solid var(--border,#8884);border-radius:4px;background:var(--background,Canvas);pointer-events:none}
af-slide-deck [data-af-deck-preview]>div{position:absolute;top:0;left:0;width:1280px;height:800px;transform:scale(.128);transform-origin:top left}
af-slide-deck>[data-af-deck-chrome=toolbar]{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);display:flex;align-items:center;gap:6px;z-index:1000;padding:5px 8px;border:1px solid var(--border,#8886);border-radius:999px;background:color-mix(in srgb,var(--background,Canvas) 88%,transparent);color:inherit;backdrop-filter:blur(6px);font:12px/1.5 ui-sans-serif,system-ui,sans-serif}
af-slide-deck>[data-af-deck-chrome=toolbar][hidden]{display:none}
af-slide-deck>[data-af-deck-chrome=toolbar]>button{cursor:pointer;border:0;border-radius:999px;background:none;color:inherit;font:inherit;padding:2px 8px;line-height:1.4}
af-slide-deck>[data-af-deck-chrome=toolbar]>output{font-variant-numeric:tabular-nums;color:var(--muted-foreground,gray);padding:0 2px}
af-slide-deck>[data-af-deck-chrome=toolbar]>button:disabled{opacity:.5;cursor:default}
af-slide-deck [data-af-deck-row]:hover,af-slide-deck>[data-af-deck-chrome=toolbar]>button:enabled:hover{background:color-mix(in srgb,var(--foreground,gray) 14%,transparent)}
af-slide-deck [data-af-deck-row]:focus-visible,af-slide-deck>[data-af-deck-chrome=toolbar]>button:focus-visible,af-slide-deck:focus-visible{outline:2px solid var(--ring,Highlight);outline-offset:2px}
af-slide-deck>[data-af-deck-chrome=status]{position:absolute;clip-path:inset(50%);width:1px;height:1px;overflow:hidden}
af-slide-deck:fullscreen{display:block;overflow:auto}
af-slide-deck:fullscreen>[data-af-deck-chrome=rail]{display:none}
af-slide-deck:fullscreen>af-slide{min-height:100svh}
@media(max-width:720px){af-slide-deck{grid-template-columns:minmax(0,1fr)}af-slide-deck>[data-af-deck-chrome=rail]{display:none}af-slide-deck>af-slide{grid-column:1}}
@media print{af-slide-deck{display:block;background:transparent}af-slide-deck>[data-af-deck-chrome]{display:none!important}af-slide{display:flex;break-after:page;break-inside:avoid;min-height:0}af-slide:last-of-type{break-after:auto}}
`;
registerComponent({
  styleKey: 'af-slide-deck-styles',
  styles: slideDeckStyles,
  elements: { 'af-slide-deck': AfSlideDeck, 'af-slide': AfSlide },
});
