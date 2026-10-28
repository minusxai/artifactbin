/**
 * Internal: selection math, rail rows/previews, chrome builders and owner lookup for
 *   af-slide-deck.
 * Used by: slide-deck.ts.
 */
/** Author-owned zero-based selection.
 * Empty decks expose -1 and never emit an empty selection intent. */
export interface SlideDeckChangeDetail { value: number }
export interface SlideDeckContract { index: number | undefined }
export function slideIndex(index: number, count: number): number {
  return count<=0?-1:Math.max(0,Math.min(Number.isFinite(index)?Math.floor(index):0,count-1));
}
export function slideKeyIndex(key: string, current: number, count: number): number | null {
  if(key==='Home')return slideIndex(0,count);
  if(key==='End')return slideIndex(count-1,count);
  if(key==='ArrowRight'||key==='PageDown'||key===' ')return slideIndex(current+1,count);
  if(key==='ArrowLeft'||key==='PageUp')return slideIndex(current-1,count);
  return null;
}
export function visibleSlideIndex(tops: readonly number[], mark: number): number {
  let index=tops.length?0:-1;
  tops.forEach((top,i)=>{if(top<=mark)index=i;});return index;
}
/** Missing or blank attributes use the fallback; anything else goes through Number(). */
export const numberAttribute=(element:Element,name:string,fallback:number):number=>{
  const raw=element.getAttribute(name);return raw===null||raw.trim()===''?fallback:Number(raw);
};
/** Keys typed into these targets never page the deck. */
export const EDITABLE_TARGETS='input,textarea,select,button,a[href],'+
  '[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="slider"],'+
  '[role="switch"]';

const previewSvgTags=new Set(['svg','g','path','rect','circle','ellipse','line','polyline',
  'polygon','text','tspan']);
const previewSvgAttributes=['viewBox','d','points','x','y','x1','x2','y1','y2','width','height',
  'cx','cy','r','rx','ry','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin',
  'transform','opacity','font-size','font-weight','text-anchor','preserveAspectRatio'];
const previewTags=new Set(['div','section','article','p','h1','h2','h3','h4','h5','h6','span',
  'strong','em','ul','ol','li','dl','dt','dd','table','thead','tbody','tr','th','td','blockquote',
  'pre','code','br','hr']);
const previewProperties=['display','flex-direction','flex-wrap','align-items','justify-content',
  'gap','grid-template-columns','padding','margin','color','background-color','font-size',
  'font-weight','line-height','text-align','border','border-radius','width','height','max-width',
  'min-height'];
const droppedTags=['script','style','link','iframe','object','embed','audio','video','source',
  'template'];
/** Rebuild only passive HTML: no custom element upgrade, copied identity, event attribute, URL
 * or nested control. */
export function previewNode(source:Node,doc:Document):Node {
  if(source.nodeType===3)return doc.createTextNode(source.textContent??'');
  if(!(source instanceof Element))return doc.createTextNode('');
  if(droppedTags.includes(source.localName))return doc.createTextNode('');
  if(source.localName==='img')return doc.createTextNode(source.getAttribute('alt')??'');
  // Form controls become their current value as plain text.
  if(source instanceof HTMLInputElement || source instanceof HTMLTextAreaElement ||
    source instanceof HTMLSelectElement)return doc.createTextNode(source.value);
  if(source.namespaceURI==='http://www.w3.org/2000/svg'){
    if(!previewSvgTags.has(source.localName))return doc.createTextNode('');
    const node=doc.createElementNS('http://www.w3.org/2000/svg',source.localName);
    for(const attribute of previewSvgAttributes){
      const value=source.getAttribute(attribute);
      if(value!==null&&!/url\s*\(|javascript:|https?:|data:/i.test(value))
        node.setAttribute(attribute,value);
    }
    for(const child of source.childNodes)node.append(previewNode(child,doc));return node;
  }
  const node=doc.createElement(previewTags.has(source.localName)?source.localName:'div');
  // CSS classes may be used by authored design systems; URL-bearing attributes and inline URL
  // paints are never copied.
  if(source.hasAttribute('class'))node.className=source.getAttribute('class')!;
  if(source instanceof HTMLElement)for(const property of previewProperties){
    const value=source.style.getPropertyValue(property);
    if(value && !/url\s*\(|var\s*\(/i.test(value))node.style.setProperty(property,value);
  }
  if(source.localName==='af-slide')node.setAttribute('data-af-preview-slide','');
  for(const child of source.childNodes)node.append(previewNode(child,doc));
  return node;
}
/** Rail, floating toolbar and live status; every node is tagged so mutations inside are ignored. */
export function buildDeckChrome(doc:Document) {
  const rail=doc.createElement('nav');rail.setAttribute('aria-label','Slides');
  rail.dataset.afDeckChrome='rail';
  const toolbar=doc.createElement('div');toolbar.dataset.afDeckChrome='toolbar';
  toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','Slide controls');
  const button=(label:string,text:string)=>{
    const node=doc.createElement('button');node.type='button';
    node.setAttribute('aria-label',label);node.textContent=text;return node;
  };
  const previous=button('Previous slide','‹'),next=button('Next slide','›'),
    present=button('Present','present');
  const count=doc.createElement('output');count.dataset.afDeckCount='';
  count.setAttribute('aria-label','Slide count');
  toolbar.append(previous,count,next,present);
  const status=doc.createElement('span');status.setAttribute('role','status');
  status.dataset.afDeckChrome='status';
  return {rail,toolbar,previous,next,present,count,status};
}
/** Fill a rail row: number + title label and an inert, scaled-down passive preview. */
export function fillSlideRow(row:HTMLButtonElement,slide:HTMLElement,i:number,title:string):void {
  const doc=row.ownerDocument;
  const label=doc.createElement('span');label.dataset.afDeckLabel='';
  const number=doc.createElement('span');number.dataset.afDeckIndex='';
  number.textContent=String(i+1);
  const heading=doc.createElement('span');heading.dataset.afDeckTitle='';
  heading.textContent=title;label.append(number,heading);
  const preview=doc.createElement('span');preview.dataset.afDeckPreview='';
  preview.setAttribute('inert','');preview.setAttribute('aria-hidden','true');
  const miniature=doc.createElement('div');miniature.append(previewNode(slide,doc));
  preview.append(miniature);
  row.replaceChildren(label,preview);
}
let sequence=0;
/** Create or refresh the rail row for one slide; generated slide ids are unique in the document
 * and never overwrite an authored id. */
export function railRow(rows:WeakMap<HTMLElement,HTMLButtonElement>,slide:HTMLElement,i:number,
  index:number):HTMLButtonElement {
  const doc=slide.ownerDocument,title=slideTitle(slide,i);
  if(!slide.id){let id:string;do{id=`af-slide-${++sequence}`;}while(doc.getElementById(id));
    slide.id=id;}
  let row=rows.get(slide);
  if(!row){row=doc.createElement('button');row.type='button';row.dataset.afDeckRow='';
    rows.set(slide,row);}
  row.dataset.index=String(i);row.setAttribute('aria-label',`Go to slide ${i+1}: ${title}`);
  row.setAttribute('aria-controls',slide.id);row.setAttribute('aria-current',String(i===index));
  fillSlideRow(row,slide,i,title);return row;
}
export function slideTitle(slide:HTMLElement,index:number):string{
  return slide.getAttribute('title')??slide.querySelector('h1,h2,h3')?.textContent?.trim()??
    `Slide ${index+1}`;
}
/** Mutations inside deck chrome must not re-sync, or rebuilding the rail would loop forever. */
export function isAuthoredMutation(deck:Element,record:MutationRecord):boolean {
  const target=record.target instanceof Element?record.target:record.target.parentElement;
  if(target?.closest('[data-af-deck-chrome]'))return false;
  if(record.type==='childList' && target===deck)return [...record.addedNodes,
    ...record.removedNodes].some(node=>!(node instanceof Element && node.hasAttribute(
    'data-af-deck-chrome')));
  return true;
}
/** The deck that owns page-level keys and the toolbar: the fullscreen deck, then the focused
 * one, then the top-level deck crossing the reading mark (upper third of the viewport), else the
 * first still on screen, else a lone deck. */
export function documentDeck<T extends Element>(doc:Document,
  Deck:abstract new()=>T):T|undefined {
  if(doc.fullscreenElement instanceof Deck)return doc.fullscreenElement;
  const focused=doc.activeElement?.closest<T>('af-slide-deck');if(focused)return focused;
  const decks=[...doc.querySelectorAll<T>('af-slide-deck')].filter(deck=>
    !deck.parentElement?.closest('af-slide-deck'));
  const mark=(doc.defaultView?.innerHeight??0)/3;
  return decks.find(deck=>{const rect=deck.getBoundingClientRect();
    return rect.top<=mark&&rect.bottom>mark;})??
    decks.find(deck=>deck.getBoundingClientRect().bottom>0)??
    (decks.length===1?decks[0]:undefined);
}
