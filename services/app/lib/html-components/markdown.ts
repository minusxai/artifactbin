export interface MarkdownContract { source: string }
import { markdownContent } from '../markdown/content';
let nextHeadingScope = 0;
/** Only generated output is replaced; the host remains the authored identity. */
export class AfMarkdown extends HTMLElement implements MarkdownContract {
 static observedAttributes = ['source'];
 private value: string | undefined;
 private output: HTMLDivElement | undefined;
 private scope = `af-markdown-${++nextHeadingScope}`;
 get source(): string { return this.value ?? this.getAttribute('source') ?? ''; }
 set source(value: string) { this.value=String(value); this.render(); }
 connectedCallback(): void {
  if(Object.prototype.hasOwnProperty.call(this,'source')) { const value=this.source; delete (this as {source?:string}).source; this.source=value; }
  if(!this.output) { if(this.value===undefined && !this.hasAttribute('source')) this.value=this.textContent ?? ''; for(const node of [...this.childNodes]) if(node.nodeType===Node.TEXT_NODE) node.remove(); this.output=document.createElement('div'); this.output.className='mx-markdown'; this.append(this.output); }
  this.render();
 }
 attributeChangedCallback(): void { this.render(); }
 private render(): void {
  if(!this.output) return;
  const rendered=markdownContent(this.source);
  if(rendered.errors.length) { const alert=document.createElement('p'); alert.setAttribute('role','alert'); alert.textContent=rendered.errors.join(' '); this.output.replaceChildren(alert); return; }
  this.output.innerHTML=rendered.html;
  this.output.querySelectorAll<HTMLElement>('[data-mx-markdown-heading]').forEach(heading=>{heading.id=`${this.id || this.scope}-heading-${heading.dataset.mxMarkdownHeading}`;});
  this.output.querySelectorAll('pre').forEach(pre=>{const code=pre.querySelector('code'); if(!code) return; const button=document.createElement('button'); button.type='button'; button.textContent='Copy code'; button.addEventListener('click',()=>{void navigator.clipboard?.writeText(code.textContent ?? '').then(()=>{button.textContent='Copied';},()=>{button.textContent='Copy unavailable';});}); pre.append(button);});
 }
}
const markdownStyles=`af-markdown{display:block}af-markdown .mx-markdown{line-height:1.65;overflow-wrap:anywhere}af-markdown pre{overflow:auto;padding:1rem;background:var(--muted,#f3f4f6);border-radius:.4rem}af-markdown pre button{display:block;margin-top:.5rem;color:inherit;font:inherit}af-markdown .mx-md-table-scroll{overflow:auto}af-markdown table{border-collapse:collapse;width:100%}af-markdown th,af-markdown td{padding:.5rem;border:1px solid var(--border,#ccc)}af-markdown blockquote{border-inline-start:3px solid var(--border,#ccc);padding-inline-start:1rem}af-markdown .mx-code-token-keyword{color:var(--primary,#7257c2)}af-markdown .mx-code-token-string{color:var(--success,#26834a)}af-markdown .mx-code-token-comment{color:var(--muted-foreground,#777)}af-markdown .mx-code-token-number{color:var(--primary,#7257c2)}`;
export function registerMarkdown(registry:CustomElementRegistry=customElements,doc:Document=document):void {
 if(!doc.querySelector('style[data-af-markdown-styles]')) {const style=doc.createElement('style');style.setAttribute('data-af-markdown-styles','');style.textContent=markdownStyles;doc.head.append(style);}
 if(!registry.get('af-markdown')) registry.define('af-markdown',AfMarkdown);
}
