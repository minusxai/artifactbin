/**
 * <af-markdown>: renders GitHub-flavoured Markdown with code highlighting and copy buttons;
 *   unsafe or unsupported content is rejected.
 * Usage: import '@afbin/markdown';  (registers the tags; this .ts is the readable contract)
 * Props: source (property wins over the source attribute, then the initial text).
 * Examples:
 *   <af-markdown>## Notes\n- one\n- two</af-markdown>
 * Styles: Markdown and docs share one stylesheet (markdown-styles.ts); the design system sets
 *   fonts and colours; for one page add a small <style> override such as
 *   `article { line-height: 1.4 }`.
 * Gotchas: the initial text is read once as the source; later edits go through source.
 */
import { registerComponent } from './register-component';
/** Generated output is an `af-markdown-body` root styled by the one Markdown stylesheet
 * (./markdown-styles), the same sheet docs use; copy controls overlay code without changing
 * its layout.
 * Property source takes precedence over the source attribute, then initial literal text. */
export interface MarkdownContract { source: string; copyControls: boolean }
import { markdownContent } from '../markdown/content';
import { MARKDOWN_CSS, MARKDOWN_ROOT } from './markdown-styles';
let nextHeadingScope = 0;
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
set copyControls(value: boolean) { if(value)this.removeAttribute('copy-controls');
   else this.setAttribute('copy-controls','false'); }
 connectedCallback(): void {
for(const key of ['source','copyControls'] as const)if(Object.prototype.hasOwnProperty.call(this,
    key)){const value=this[key];delete (this as unknown as Record<string,unknown>)[key];
    Object.assign(this,{[key]:value});}
if(!this.output) { this.literalSource=[...this.childNodes].filter(node=>node.nodeType===3).map(
    node=>node.textContent ?? '').join(''); for(const node of [...this.childNodes]) if(
    node.nodeType===3) node.remove(); this.output=this.ownerDocument.createElement('div');
    this.output.className=`mx-markdown ${MARKDOWN_ROOT.slice(1)}`;
    this.append(this.output); }
  this.render();
 }
 attributeChangedCallback(): void { this.render(); }
 private render(): void {
  if(!this.output) return;
  const rendered=markdownContent(this.source);
if(rendered.errors.length) { const alert=this.ownerDocument.createElement('p'); alert.setAttribute(
    'role','alert'); alert.textContent=rendered.errors.join(' '); this.output.replaceChildren(
    alert); return; }
  this.output.innerHTML=rendered.html;
this.output.querySelectorAll<HTMLElement>('[data-mx-markdown-heading]').forEach(heading=>{
    heading.id=`${this.id || this.scope}-heading-${heading.dataset.mxMarkdownHeading}`;});
if(this.copyControls)this.output.querySelectorAll('pre').forEach(pre=>{const code=pre.querySelector(
    'code'); if(!code) return; const button=this.ownerDocument.createElement('button'); button.type=
    'button'; button.textContent='Copy code'; button.addEventListener('click',()=>{const clipboard=
    this.ownerDocument.defaultView?.navigator.clipboard; if(!clipboard?.writeText){
    button.textContent='Copy unavailable';return;} try {void clipboard.writeText(code.textContent ??
    '').then(()=>{button.textContent='Copied';},()=>{button.textContent='Copy unavailable';});
    } catch {button.textContent='Copy unavailable';}}); pre.append(button);});
 }
}
// The shared Markdown sheet, then this element's own chrome: block display and the copy button.
const markdownStyles=`${MARKDOWN_CSS}
af-markdown{display:block}
af-markdown pre{position:relative}
af-markdown pre button{position:absolute;top:.5rem;right:.5rem;opacity:0;padding:.25rem .5rem;` +
  `color:var(--foreground,CanvasText);background:var(--background,Canvas);` +
  `border:1px solid var(--border,#8888);border-radius:var(--radius-sm,calc(var(--radius,` +
  `.625rem) - .25rem));font:inherit;cursor:pointer}
af-markdown pre:hover button,af-markdown pre:focus-within button{opacity:1}
af-markdown pre button:hover{background:var(--muted,Canvas)}
af-markdown pre button:focus-visible{outline:2px solid var(--ring,Highlight);outline-offset:2px}
`;
registerComponent({
  styleKey: 'af-markdown-styles',
  styles: markdownStyles,
  elements: { 'af-markdown': AfMarkdown },
});
