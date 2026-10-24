/** Property source takes precedence over the source attribute, then initial literal text. */
export interface MarkdownContract { source: string }
import { markdownContent } from '../markdown/content';
import { MARKDOWN_CSS } from '../markdown/styles';
let nextHeadingScope = 0;
function splitSelectors(value:string):string[]{
 const selectors:string[]=[];let start=0,depth=0,quote='',comment=false;
 for(let index=0;index<value.length;index++){
  const char=value[index],next=value[index+1];
  if(comment){if(char==='*'&&next==='/'){comment=false;index++;}continue;}
  if(quote){if(char==='\\'){index++;continue;}if(char===quote)quote='';continue;}
  if(char==='/'&&next==='*'){comment=true;index++;continue;}
  if(char==='"'||char==="'"){quote=char;continue;}
  if(char==='('||char==='[')depth++;
  else if(char===')'||char===']')depth--;
  else if(char===','&&depth===0){selectors.push(value.slice(start,index));start=index+1;}
 }
 selectors.push(value.slice(start));return selectors;
}
function scopeMarkdownBranch(value:string):string{
 const leading=value.match(/^(?:(?:\s+)|(?:\/\*[\s\S]*?\*\/\s*))*/)?.[0]??'';
 const selector=value.slice(leading.length).trim();
 const ancestorTheme=selector.match(/^(\.dark|\[data-theme=["']dark["']\])\s+(.*)$/s);
 if(ancestorTheme){const scoped=`${ancestorTheme[1]} af-markdown ${ancestorTheme[2]}`;return `${leading}${ancestorTheme[1]==='.dark'?`${scoped}, [data-af-dark="true"] af-markdown ${ancestorTheme[2]}`:scoped}`;}
 if(selector.startsWith(':where(')){
  let depth=1,quote='',comment=false,close=-1;
  for(let index=7;index<selector.length;index++){
   const char=selector[index],next=selector[index+1];
   if(comment){if(char==='*'&&next==='/'){comment=false;index++;}continue;}
   if(quote){if(char==='\\'){index++;continue;}if(char===quote)quote='';continue;}
   if(char==='/'&&next==='*'){comment=true;index++;continue;}
   if(char==='"'||char==="'"){quote=char;continue;}
   if(char==='(')depth++;else if(char===')'&&--depth===0){close=index;break;}
  }
  if(close>=0){const scoped=splitSelectors(selector.slice(7,close)).map(scopeMarkdownBranch).join(', ');return `${leading}:where(${scoped})${selector.slice(close+1)}`;}
 }
 return `${leading}af-markdown ${selector}`;
}
function scopeMarkdownCss(css:string):string{
 // MARKDOWN_CSS is a flat list of rules. Split only selector commas at the
 // top level so commas inside :where(), :has(), fallbacks, and strings survive.
 return css.replace(/(^|})([^{}]+)\{/g,(_rule,close:string,selectors:string)=>`${close}${splitSelectors(selectors).map(scopeMarkdownBranch).join(', ')}{`);
}
/** Only generated output is replaced; the host remains the authored identity. */
export class AfMarkdown extends HTMLElement implements MarkdownContract {
 static observedAttributes = ['source'];
 private value: string | undefined;
 private literalSource = "";
 private output: HTMLDivElement | undefined;
 private scope = `af-markdown-${++nextHeadingScope}`;
 get source(): string { return this.value ?? this.getAttribute('source') ?? this.literalSource; }
 set source(value: string) { this.value=String(value); this.render(); }
 connectedCallback(): void {
  if(Object.prototype.hasOwnProperty.call(this,'source')) { const value=this.source; delete (this as {source?:string}).source; this.source=value; }
  if(!this.output) { this.literalSource=[...this.childNodes].filter(node=>node.nodeType===3).map(node=>node.textContent ?? '').join(''); for(const node of [...this.childNodes]) if(node.nodeType===3) node.remove(); this.output=this.ownerDocument.createElement('div'); this.output.className='mx-markdown'; this.append(this.output); }
  this.render();
 }
 attributeChangedCallback(): void { this.render(); }
 private render(): void {
  if(!this.output) return;
  const rendered=markdownContent(this.source);
  if(rendered.errors.length) { const alert=this.ownerDocument.createElement('p'); alert.setAttribute('role','alert'); alert.textContent=rendered.errors.join(' '); this.output.replaceChildren(alert); return; }
  this.output.innerHTML=rendered.html;
  this.output.querySelectorAll<HTMLElement>('[data-mx-markdown-heading]').forEach(heading=>{heading.id=`${this.id || this.scope}-heading-${heading.dataset.mxMarkdownHeading}`;});
  this.output.querySelectorAll('pre').forEach(pre=>{const code=pre.querySelector('code'); if(!code) return; const button=this.ownerDocument.createElement('button'); button.type='button'; button.textContent='Copy code'; button.addEventListener('click',()=>{const clipboard=this.ownerDocument.defaultView?.navigator.clipboard; if(!clipboard?.writeText){button.textContent='Copy unavailable';return;} try {void clipboard.writeText(code.textContent ?? '').then(()=>{button.textContent='Copied';},()=>{button.textContent='Copy unavailable';});} catch {button.textContent='Copy unavailable';}}); pre.append(button);});
 }
}
const markdownStyles=`${scopeMarkdownCss(MARKDOWN_CSS)}
af-markdown{display:block}
af-markdown .mx-markdown > :first-child{margin-block-start:0}
af-markdown pre{overflow:auto}
af-markdown pre button{display:block;margin-top:.5rem;padding:.25rem .5rem;color:var(--foreground,CanvasText);background:var(--background,Canvas);border:1px solid var(--border,#8888);border-radius:var(--radius-sm,calc(var(--radius,.625rem) - .25rem));font:inherit;cursor:pointer}
af-markdown pre button:hover{background:var(--muted,Canvas)}
af-markdown pre button:focus-visible{outline:2px solid var(--ring,Highlight);outline-offset:2px}
`;
export function registerMarkdown(registry:CustomElementRegistry=customElements,doc:Document=document):void {
 if(!doc.querySelector('style[data-af-markdown-styles]')) {const style=doc.createElement('style');style.setAttribute('data-af-markdown-styles','');style.textContent=markdownStyles;doc.head.append(style);}
 if(!registry.get('af-markdown')) registry.define('af-markdown',AfMarkdown);
}
