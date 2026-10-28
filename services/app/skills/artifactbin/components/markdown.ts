/**
 * <af-markdown>: renders GitHub-flavoured Markdown with code highlighting and copy buttons; unsafe or unsupported content is rejected.
 * Import:  import '@afbin/markdown';  (registers the tags; this .ts is the readable contract)
 * Props: source (property wins over the source attribute, then the initial text)
 * Usage:
 *   <af-markdown>## Notes\n- one\n- two</af-markdown>
 */
import { registerComponent } from './register-component';
/** Generated Markdown retains reader bare typography/table scrolling; copy controls overlay code without changing its layout.
 * Property source takes precedence over the source attribute, then initial literal text. */
export interface MarkdownContract { source: string; copyControls: boolean }
import { markdownContent } from '../markdown/content';
import { MARKDOWN_CSS } from '../markdown/styles';
import { STORY_BARE_TYPOGRAPHY_CSS } from '../story-surface/bare-typography';
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
 static observedAttributes = ['source','copy-controls'];
 private value: string | undefined;
 private literalSource = "";
 private output: HTMLDivElement | undefined;
 private scope = `af-markdown-${++nextHeadingScope}`;
 get source(): string { return this.value ?? this.getAttribute('source') ?? this.literalSource; }
 set source(value: string) { this.value=String(value); this.render(); }
 get copyControls(): boolean { return this.getAttribute('copy-controls') !== 'false'; }
 set copyControls(value: boolean) { if(value)this.removeAttribute('copy-controls');else this.setAttribute('copy-controls','false'); }
 connectedCallback(): void {
  for(const key of ['source','copyControls'] as const)if(Object.prototype.hasOwnProperty.call(this,key)){const value=this[key];delete (this as unknown as Record<string,unknown>)[key];Object.assign(this,{[key]:value});}
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
  if(this.copyControls)this.output.querySelectorAll('pre').forEach(pre=>{const code=pre.querySelector('code'); if(!code) return; const button=this.ownerDocument.createElement('button'); button.type='button'; button.textContent='Copy code'; button.addEventListener('click',()=>{const clipboard=this.ownerDocument.defaultView?.navigator.clipboard; if(!clipboard?.writeText){button.textContent='Copy unavailable';return;} try {void clipboard.writeText(code.textContent ?? '').then(()=>{button.textContent='Copied';},()=>{button.textContent='Copy unavailable';});} catch {button.textContent='Copy unavailable';}}); pre.append(button);});
 }
}
// The retained document applies preflight, Markdown, bare prose, then the
// every-document table scroll rule. Keep that cascade inside generated output.
const readerBareTypography=STORY_BARE_TYPOGRAPHY_CSS
 .replaceAll(':where([data-mx-story-root])',':where(af-markdown .mx-markdown)')
 .replaceAll(':where([data-mx-story-root]:not([data-mx-styled]))',':where(af-markdown):not(*)');
const markdownStyles=`
:where(af-markdown .mx-markdown,af-markdown .mx-markdown *){box-sizing:border-box;margin:0;padding:0;border:0 solid}
:where(af-markdown pre,af-markdown code,af-markdown kbd,af-markdown samp){font-family:var(--font-mono,ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace);font-feature-settings:normal;font-variation-settings:normal;font-size:1em}
${scopeMarkdownCss(MARKDOWN_CSS)}
/* The original reader's Markdown sheet follows the application preflight,
   which leaves code at its parent size. Restore that final cascade after the
   shared Markdown rules, for inline and fenced code alike. */
:where(af-markdown .mx-markdown code){font-size:1em}
${readerBareTypography}
af-markdown .mx-markdown table{display:block;width:fit-content;max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}
af-markdown{display:block}
af-markdown .mx-markdown > :first-child{margin-block-start:0}
af-markdown pre{position:relative;overflow:auto}
af-markdown pre button{position:absolute;top:.5rem;right:.5rem;opacity:0;padding:.25rem .5rem;color:var(--foreground,CanvasText);background:var(--background,Canvas);border:1px solid var(--border,#8888);border-radius:var(--radius-sm,calc(var(--radius,.625rem) - .25rem));font:inherit;cursor:pointer}
af-markdown pre:hover button,af-markdown pre:focus-within button{opacity:1}
af-markdown pre button:hover{background:var(--muted,Canvas)}
af-markdown pre button:focus-visible{outline:2px solid var(--ring,Highlight);outline-offset:2px}
`;
registerComponent({
  styleKey: 'af-markdown-styles',
  styles: markdownStyles,
  elements: { 'af-markdown': AfMarkdown },
});
