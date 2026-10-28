/**
 * <af-slide-deck>: keyboard-navigable deck of af-slide children with presentation and print mode.
 * Usage: import '@afbin/slide-deck';  (registers the tags; this .ts is the readable contract)
 * Props: index (zero-based; you own it); label (aria-label, default "Slide deck"); default-index
 *   (uncontrolled start); af-slide title (rail and aria label).
 * Events: af-change (bubbles, cancelable) with event.detail.value; reflect your Apollo value back.
 * Examples:
 *   <script type="application/json" data-af="state">{"index":0}</script>
 *   <af-slide-deck data-af-id="quarterly-deck" index="0">
 *   <af-slide data-af-id="quarterly-intro"><h1>Review</h1></af-slide>
 *   <af-slide data-af-id="quarterly-next"><h2>Next</h2></af-slide></af-slide-deck>
 *   import {client,gql} from "@afbin/apollo"; import "@afbin/slide-deck";
 *   const deck=document.querySelector("af-slide-deck"), q=gql`{index}`;
 *   const sub=client.watchQuery({query:q}).subscribe(({data})=>{
 *     if(deck.index!==data.index)deck.index=data.index;});
 *   deck.addEventListener("af-change",e=>client.updateQuery({query:q},
 *     s=>({...s,index:e.detail.value})));
 *   window.addEventListener("pagehide",()=>sub.unsubscribe(),{once:true});
 * Gotchas: slides are not export-marked: for slide images use your own data-af-slide sections.
 *   Slide IDs stay stable when reordered or edited. Check keyboard navigation and print layout
 *   in the actual page.
 */
import { registerComponent } from './register-component';
import { slideIndex, slideKeyIndex, visibleSlideIndex, numberAttribute, buildDeckChrome, railRow,
  isAuthoredMutation, documentDeck, EDITABLE_TARGETS, type SlideDeckChangeDetail,
  type SlideDeckContract } from './slide-navigation';
import { AfSlide, slideDeckStyles } from './slide-deck-parts';

/** Continuous slides with scoped rail/chrome; selection intent is author-owned, never persisted. */
export class AfSlideDeck extends HTMLElement implements SlideDeckContract {
  static observedAttributes=['index','label'];
  private selection=0;private supplied:number|undefined;private initialized=false;
  private activeSlide:HTMLElement|undefined;private ui:ReturnType<typeof buildDeckChrome>|undefined;
  private rows=new WeakMap<HTMLElement,HTMLButtonElement>();
  private observer=new MutationObserver(records=>{if(records.some(record=>
    isAuthoredMutation(this,record)))this.sync();});
  private presenting=false;private pendingPresentation=false;private frame:number|undefined;
  // connection is bumped on connect/disconnect so a pending fullscreen request can detect a move.
  private focusBeforePresentation:HTMLElement|null=null;private connection=0;
  get index():number {
    return slideIndex(this.supplied??(this.hasAttribute('index')?numberAttribute(this,'index',0):
      this.selection),this.slides().length);
  }
  set index(index:number|undefined){
    if(index===undefined)this.selection=this.index;this.supplied=index;this.sync(true);
  }
  connectedCallback():void {
    this.connection++;
    // A property set before upgrade shadows the accessor; replay it through the setter.
    if(Object.prototype.hasOwnProperty.call(this,'index')){
      const index=this.index;delete (this as {index?:number}).index;this.index=index;
    }
    if(!this.initialized)this.selection=numberAttribute(this,'default-index',0);
    this.initialized=true;
    if(!this.hasAttribute('tabindex'))this.tabIndex=0;
    if(!this.hasAttribute('role'))this.setAttribute('role','region');
    this.setAttribute('aria-roledescription','slide deck');
    if(!this.ui){this.ui=buildDeckChrome(this.ownerDocument);
      this.prepend(this.ui.rail);this.append(this.ui.toolbar,this.ui.status);}
    this.sync();
    this.addEventListener('click',this.clickControl);this.listen('addEventListener');
    this.observer.observe(this,{subtree:true,childList:true,characterData:true,attributes:true,
      attributeFilter:['title','id','label']});
    this.frame=this.ownerDocument.defaultView?.requestAnimationFrame(()=>{this.frame=undefined;
      if(this.index>0)this.scrollToIndex();});
  }
  disconnectedCallback():void {
    this.connection++;
    const doc=this.ownerDocument,win=doc.defaultView;
    this.observer.disconnect();this.removeEventListener('click',this.clickControl);
    this.listen('removeEventListener');
    if(this.frame!==undefined)win?.cancelAnimationFrame(this.frame);
    this.frame=undefined;this.focusBeforePresentation=null;
    if(doc.fullscreenElement===this)void doc.exitFullscreen?.().catch(()=>{});
    this.presenting=false;
  }
  // Page-level listeners: keys, toolbar visibility, fullscreen and scroll-driven selection.
  private listen(method:'addEventListener'|'removeEventListener'):void {
    const doc=this.ownerDocument,win=doc.defaultView;
    doc[method]('keydown',this.keydown as EventListener);doc[method]('focusin',this.paintToolbar);
    doc[method]('fullscreenchange',this.fullscreenChange);
    win?.[method]('scroll',this.onScroll,{passive:true});win?.[method]('resize',this.onScroll);
  }
  attributeChangedCallback(name:string):void {this.sync(name==='index');}
  // Only direct slides: a nested deck owns its own af-slide children.
  private slides():HTMLElement[]{return [...this.querySelectorAll<HTMLElement>('af-slide')]
    .filter(slide=>slide.closest('af-slide-deck')===this);}
  private controlled():boolean{return this.supplied!==undefined || this.hasAttribute('index');}
  private sync(scroll=false):void {
    if(!this.isConnected || !this.ui)return;
    const {rail,count,previous,next,present,toolbar}=this.ui,slides=this.slides();
    // Uncontrolled selection follows the active slide when slides are added or reordered.
    if(!this.controlled() && this.activeSlide && slides.includes(this.activeSlide))
      this.selection=slides.indexOf(this.activeSlide);
    if(!this.controlled())this.selection=slideIndex(this.selection,slides.length);
    const index=this.index;this.activeSlide=slides[index];
    this.setAttribute('aria-label',this.getAttribute('label')??'Slide deck');
    this.style.setProperty('--af-deck-slide-count',String(Math.max(1,slides.length)));
    const retained=new Set(slides.map(slide=>this.rows.get(slide)));
    for(const row of [...rail.children])if(!retained.has(row as HTMLButtonElement))row.remove();
    const keep=new Set<HTMLButtonElement>();
    slides.forEach((slide,i)=>{
      const row=railRow(this.rows,slide,i,index);keep.add(row);
      const at=rail.children[i];if(at!==row)rail.insertBefore(row,at??null);
    });
    for(const row of rail.children)if(!keep.has(row as HTMLButtonElement))row.remove();
    count.textContent=`${slides.length?index+1:0} / ${slides.length}`;
    // The reader keeps both paging controls available at the ends. Requests
    // are clamped by slideIndex, so a boundary click is a harmless no-op and
    // never wraps around the deck.
    previous.disabled=index<0;next.disabled=index<0;
    present.disabled=slides.length===0||this.pendingPresentation;
    this.paintPresentation();toolbar.hidden=this.documentDeck()!==this;
    if(scroll)this.scrollToIndex();
  }
  private scrollToIndex():void {
    const reduced=this.ownerDocument.defaultView?.matchMedia?.(
      '(prefers-reduced-motion: reduce)').matches;
    this.slides()[this.index]?.scrollIntoView?.({behavior:reduced?'auto':'smooth',block:'start'});
  }
  // Emit a cancelable intent; only an uncontrolled deck applies it itself.
  private request(index:number,scroll:boolean):void {
    const next=slideIndex(index,this.slides().length);if(next<0||next===this.index)return;
    const intent=new CustomEvent<SlideDeckChangeDetail>('af-change',{detail:{value:next},
      bubbles:true,composed:true,cancelable:true});
    if(!this.dispatchEvent(intent))return;
    if(this.controlled())return;
    this.selection=next;this.activeSlide=this.slides()[next];this.sync(scroll);
  }
  private clickControl=(event:MouseEvent):void=>{
    if(event.defaultPrevented || !(event.target instanceof Element) || event.target.closest(
      'af-slide-deck')!==this)return;
    const button=event.target.closest<HTMLButtonElement>('button');
    if(!button||button.disabled||!this.ui)return;
    if(button===this.ui.previous)this.request(this.index-1,true);
    else if(button===this.ui.next)this.request(this.index+1,true);
    else if(button===this.ui.present)void this.toggleFullscreen();
    else if(button.closest('nav')===this.ui.rail)this.request(Number(button.dataset.index),true);
  };
  private documentDeck():AfSlideDeck|undefined {
    return documentDeck(this.ownerDocument,AfSlideDeck);}
  private keydown=(event:KeyboardEvent):void=>{
    if(event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
    const target=event.target instanceof Element?event.target:null;
    if(target?.closest(EDITABLE_TARGETS))return;
    const owner=target?.closest('af-slide-deck')??this.documentDeck();if(owner!==this)return;
    const next=slideKeyIndex(event.key,this.index,this.slides().length);
    if(next===null||next<0)return;
    event.preventDefault();this.request(next,true);
  };
  private paintToolbar=():void=>{if(this.ui)this.ui.toolbar.hidden=this.documentDeck()!==this;};
  // Scrolling selects the slide under the reading mark.
  private onScroll=():void=>{
    this.ui && (this.ui.toolbar.hidden=this.documentDeck()!==this);
    const mark=(this.ownerDocument.defaultView?.innerHeight??0)/3;
    this.request(visibleSlideIndex(this.slides().map(slide=>slide.getBoundingClientRect().top),
      mark),false);
  };
  private paintPresentation():void {
    if(!this.ui)return;
    const full=this.ownerDocument.fullscreenElement===this;
    this.ui.present.setAttribute('aria-label',full?'Exit presentation':'Present');
    this.ui.present.textContent=full?'exit':'present';
  }
  private fullscreenChange=():void=>{
    const full=this.ownerDocument.fullscreenElement===this;this.paintPresentation();
    if(this.presenting&&!full&&!this.pendingPresentation)this.restoreFocus();
    this.presenting=full;
  };
  private restoreFocus():void {
    if(this.focusBeforePresentation?.isConnected)this.focusBeforePresentation.focus();
    this.focusBeforePresentation=null;
  }
  private async toggleFullscreen():Promise<void> {
    if(this.pendingPresentation||!this.ui)return;
    const connection=this.connection,doc=this.ownerDocument,{present,status}=this.ui;
    // A native disabled button can blur immediately; save the opener while it is still focusable.
    if(doc.fullscreenElement!==this)
      this.focusBeforePresentation=doc.activeElement as HTMLElement|null;
    this.pendingPresentation=true;present.disabled=true;status.textContent='';
    try {
      if(doc.fullscreenElement===this)await doc.exitFullscreen();
      else {if(!this.requestFullscreen)throw new Error('unavailable');
        await this.requestFullscreen();}
      // Disconnected while the request was pending: leave fullscreen again.
      if(connection!==this.connection && doc.fullscreenElement===this)await doc.exitFullscreen();
    } catch {if(this.isConnected)status.textContent='Presentation unavailable';}
    finally {
      this.pendingPresentation=false;
      if(this.isConnected){present.disabled=this.slides().length===0;this.paintPresentation();
        if(doc.fullscreenElement!==this)this.restoreFocus();}
    }
  }
}
registerComponent({
  styleKey: 'af-slide-deck-styles',
  styles: slideDeckStyles,
  elements: { 'af-slide-deck': AfSlideDeck, 'af-slide': AfSlide },
});
