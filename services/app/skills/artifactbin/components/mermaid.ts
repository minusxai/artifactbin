import type { MermaidImage } from '../mermaid-images/mermaid-render';
/** Property code takes precedence over the code attribute, then initial literal text.
 * A stored image belongs to the current source; source/theme/font changes invalidate it. */
export interface MermaidContract { code: string; title: string; colorMode: 'light' | 'dark' | 'auto'; storedImage: MermaidImage | null; retry(): void }
import { mermaidSourceError } from '../jsx/mermaid-source';
/** Intentional lazy browser engine boundary; bundled from the pinned reader renderer, never a CDN. */
const draw = async (element:HTMLElement,code:string,dark:boolean,live:()=>boolean) => {const renderer=await import('../mermaid-images/reader-draw');return live() ? renderer.drawForReader(element,code,dark,live) : null;};
export class AfMermaid extends HTMLElement implements MermaidContract {
 static observedAttributes=['code','title','color-mode'];
 private source: string | undefined;
 private literalSource = "";
 private mode: 'light'|'dark'|'auto'='auto';
 private image: MermaidImage | null=null;
 private refused=false;
 private generation=0;
 private output: HTMLElement | undefined;
 private observer=new MutationObserver(()=>{this.refused=true;this.retry();});
 get code():string{return this.source ?? this.getAttribute('code') ?? this.literalSource;}
 set code(value:string){if(this.code!==String(value))this.image=null;this.source=String(value);this.refused=false;this.retry();}
 get colorMode():'light'|'dark'|'auto'{return this.mode==='auto' ? (this.getAttribute('color-mode')==='dark'?'dark':this.getAttribute('color-mode')==='light'?'light':'auto') : this.mode;}
 set colorMode(value:'light'|'dark'|'auto'){this.mode=value;this.refused=true;this.retry();}
 get storedImage():MermaidImage|null{return this.image;}
 set storedImage(value:MermaidImage|null){this.image=value;this.refused=false;this.retry();}
 connectedCallback():void {
  for(const key of ['code','colorMode','storedImage'] as const) if(Object.prototype.hasOwnProperty.call(this,key)){const value=this[key];delete (this as unknown as Record<string,unknown>)[key];Object.assign(this,{[key]:value});}
  if(!this.output){this.literalSource=[...this.childNodes].filter(node=>node.nodeType===3).map(node=>node.textContent ?? '').join('');for(const node of [...this.childNodes]) if(node.nodeType===3) node.remove();this.output=this.ownerDocument.createElement('figure');this.append(this.output);}
  for(let parent:Element|null=this;parent;parent=parent.parentElement) this.observer.observe(parent,{attributes:true,attributeFilter:['class','style','data-af-dark','data-af-design-system']});
  this.ownerDocument.fonts?.addEventListener('loadingdone',this.fontChanged); this.retry();
 }
 disconnectedCallback():void {this.generation++;this.observer.disconnect();this.ownerDocument.fonts?.removeEventListener('loadingdone',this.fontChanged);}
 attributeChangedCallback(name:string):void {if(name==='code' && this.source!==undefined)return;if(name==='code'){this.image=null;this.refused=false;}if(name==='color-mode')this.refused=true;this.retry();}
 private fontChanged=():void=>{this.refused=true;this.retry();};
 private dark():boolean {
  if(this.colorMode!=='auto')return this.colorMode==='dark';
  const ancestor=this.closest('[data-af-dark],.dark,.light');return !!ancestor && !ancestor.classList.contains('light') && ancestor.getAttribute('data-af-dark')!=='false';
 }
 retry():void {
  const revision=++this.generation;if(!this.isConnected||!this.output)return;
  const live=()=>this.isConnected && this.generation===revision;
  const caption=this.ownerDocument.createElement('figcaption');caption.textContent=this.title||'Diagram';this.output.replaceChildren(caption);
  const status=(message:string,error=false)=>{const p=this.ownerDocument.createElement('p');p.setAttribute('role',error?'alert':'status');p.textContent=message;this.output?.append(p);this.dataset.state=error?'error':'pending';};
  const error=mermaidSourceError(this.code);if(error){status(error,true);return;}
  const show=(image:MermaidImage,stored:boolean)=>{
   if(!live())return;this.output?.querySelector('[role=status]')?.remove();
   const img=this.ownerDocument.createElement('img');img.alt=this.title||'Diagram';img.src=image.src;img.style.maxWidth='100%';img.style.height='auto';if(image.width)img.width=image.width;if(image.height)img.height=image.height;
   img.addEventListener('load',()=>{if(live())this.dataset.state='ready';});
   img.addEventListener('error',()=>{if(!live())return;if(stored){this.refused=true;this.retry();}else{img.remove();status('Could not display this diagram.',true);}});this.output?.append(img);
  };
  this.dataset.state='pending';if(this.image&&!this.refused){show(this.image,true);return;}
  status('Rendering diagram…');void draw(this,this.code,this.dark(),live).then(result=>{if(live()&&result)show(result.image,false);},()=>{if(live()){this.output?.querySelector('[role=status]')?.remove();status('Could not render this diagram. Check its Mermaid syntax, then retry.',true);}});
 }
}
export function registerMermaid(registry:CustomElementRegistry=customElements,doc:Document=document):void {
 if(!doc.querySelector('style[data-af-mermaid-styles]')){const style=doc.createElement('style');style.setAttribute('data-af-mermaid-styles','');style.textContent='af-mermaid{display:block;min-width:0}af-mermaid figure{margin:1rem 0}af-mermaid figcaption{font-family:var(--font-mono,monospace);font-size:.875rem;line-height:1.25rem;font-weight:500;margin-bottom:.5rem}af-mermaid img{display:block;max-width:100%;height:auto}';doc.head.append(style);}
 if(!registry.get('af-mermaid'))registry.define('af-mermaid',AfMermaid);
}
