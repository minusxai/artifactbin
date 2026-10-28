/**
 * Internal: the <af-slide> element and the af-slide-deck stylesheet (injected once per document).
 * Used by: slide-deck.ts (its registration stylesheet and af-slide).
 */
/** One slide: a labelled group; its title attribute becomes the aria-label. */
export class AfSlide extends HTMLElement {
  static observedAttributes=['title'];
  private generatedLabel:string|undefined;
  connectedCallback():void {
    if(!this.hasAttribute('role'))this.setAttribute('role','group');
    if(!this.hasAttribute('aria-roledescription'))this.setAttribute('aria-roledescription','slide');
    this.labelSlide();
  }
  attributeChangedCallback():void {this.labelSlide();}
  // Never overwrite an aria-label the author set; only the one generated from title.
  private labelSlide():void {
    if(this.hasAttribute('aria-label') && this.getAttribute('aria-label')!==this.generatedLabel)
      return;
    const title=this.getAttribute('title');
    if(title!==null){this.setAttribute('aria-label',title);this.generatedLabel=title;}
    else {this.removeAttribute('aria-label');this.generatedLabel=undefined;}
  }
}
// Rules are byte-identical to the original single template literal; split only for width.
export const slideDeckStyles =
  '\naf-slide-deck{display:grid;grid-template-columns:190px minmax(0,1fr);align-items:start;' +
  'position:relative;width:100%;min-width:0;color:var(--foreground,CanvasText);' +
  'background:var(--background,Canvas)}\n/* Slides own composition;' +
  ' an authored content wrapper owns the column gutter. */\naf-slide{display:flex;' +
  'position:relative;box-sizing:border-box;flex-direction:column;width:100%;min-width:0;' +
  'min-height:var(--af-slide-height,100svh);padding:0;overflow-wrap:anywhere;scroll-margin-top:0}' +
  '\naf-slide>h1:first-child,af-slide>h2:first-child,af-slide>h3:first-child,' +
  'af-slide>h4:first-child,af-slide>h5:first-child,af-slide>h6:first-child{margin-top:0}\n' +
  'af-slide :is(h1,h2,h3,h4,h5,h6){font-family:var(--font-display,inherit);font-size:clamp(2rem,' +
  '5vw,2.5rem);font-weight:600;line-height:1.2}\naf-slide :is(h1,h2,h3,h4,h5,' +
  'h6):not([class]){margin-block:1.6em .5em}\naf-slide h1:not([class]){margin-block-start:0}\n' +
  'af-slide :is(p,ul,ol,blockquote,table,pre):not([class]){margin-block:.75em;max-width:68ch;' +
  'line-height:1.65}\naf-slide-deck [data-af-deck-preview] [data-af-preview-slide]{display:flex;' +
  'position:relative;box-sizing:border-box;flex-direction:column;width:100%;min-width:0;' +
  'min-height:100%;padding:0;overflow-wrap:anywhere}\n' +
  'af-slide-deck [data-af-deck-preview] [data-af-preview-slide]>h1:first-child,' +
  'af-slide-deck [data-af-deck-preview] [data-af-preview-slide]>h2:first-child,' +
  'af-slide-deck [data-af-deck-preview] [data-af-preview-slide]>h3:first-child,' +
  'af-slide-deck [data-af-deck-preview] [data-af-preview-slide]>h4:first-child,' +
  'af-slide-deck [data-af-deck-preview] [data-af-preview-slide]>h5:first-child,' +
  'af-slide-deck [data-af-deck-preview] [data-af-preview-slide]>h6:first-child{margin-top:0}\n' +
  'af-slide-deck [data-af-deck-preview] [data-af-preview-slide] :is(h1,h2,h3,h4,h5,' +
  'h6){font-family:var(--font-display,inherit);font-size:clamp(2rem,5vw,2.5rem);font-weight:600;' +
  'line-height:1.2}\naf-slide-deck [data-af-preview-slide] :is(h1,h2,h3,h4,h5,' +
  'h6):not([class]){margin-block:1.6em .5em}\n' +
  'af-slide-deck [data-af-preview-slide] h1:not([class]){margin-block-start:0}\n' +
  'af-slide-deck [data-af-preview-slide] :is(p,ul,ol,blockquote,table,' +
  'pre):not([class]){margin-block:.75em;max-width:68ch;line-height:1.65}\n' +
  'af-slide-deck>af-slide{grid-column:2}\naf-slide-deck>[data-af-deck-chrome=rail]{grid-column:1;' +
  'grid-row:1/span var(--af-deck-slide-count,1);position:sticky;top:0;width:190px;height:100vh;' +
  'overflow:auto;box-sizing:border-box;padding:12px 10px;border-right:1px solid var(--border,' +
  '#8884);background:var(--background,Canvas);font-family:ui-sans-serif,system-ui,sans-serif}\n' +
  'af-slide-deck [data-af-deck-row]{display:block;width:100%;text-align:left;cursor:pointer;' +
  'margin:0 0 8px;padding:6px;border:1px solid transparent;border-radius:6px;background:none;' +
  'color:inherit;font:inherit}\naf-slide-deck [data-af-deck-row][aria-current=true]{border-color:' +
  'var(--border,#8888);background:color-mix(in srgb,var(--foreground,gray) 12%,transparent)}\n' +
  'af-slide-deck [data-af-deck-label]{display:flex;gap:6px;align-items:baseline;font-size:11px;' +
  'line-height:1.3}\naf-slide-deck [data-af-deck-index]{color:var(--muted-foreground,gray);' +
  'font-variant-numeric:tabular-nums}\naf-slide-deck [data-af-deck-title]{overflow:hidden;' +
  'text-overflow:ellipsis;white-space:nowrap}\n' +
  'af-slide-deck [data-af-deck-preview]{display:block;position:relative;box-sizing:border-box;' +
  'width:100%;aspect-ratio:16/10;margin-top:4px;overflow:hidden;border:1px solid var(--border,' +
  '#8884);border-radius:4px;background:var(--background,Canvas);pointer-events:none}\n' +
  'af-slide-deck [data-af-deck-preview]>div{position:absolute;top:0;left:0;width:1280px;' +
  'height:800px;transform:scale(.128);transform-origin:top left}\n' +
  'af-slide-deck>[data-af-deck-chrome=toolbar]{position:fixed;left:50%;bottom:16px;' +
  'transform:translateX(-50%);display:flex;align-items:center;gap:6px;z-index:1000;' +
  'padding:5px 8px;border:1px solid var(--border,#8886);border-radius:999px;' +
  'background:color-mix(in srgb,var(--background,Canvas) 88%,transparent);color:inherit;' +
  'backdrop-filter:blur(6px);font:12px/1.5 ui-sans-serif,system-ui,sans-serif}\n' +
  'af-slide-deck>[data-af-deck-chrome=toolbar][hidden]{display:none}\n' +
  'af-slide-deck>[data-af-deck-chrome=toolbar]>button{cursor:pointer;border:0;' +
  'border-radius:999px;background:none;color:inherit;font:inherit;padding:2px 8px;' +
  'line-height:1.4}\naf-slide-deck>[data-af-deck-chrome=toolbar]>output{font-variant-numeric:tabu' +
  'lar-nums;color:var(--muted-foreground,gray);padding:0 2px}\n' +
  'af-slide-deck>[data-af-deck-chrome=toolbar]>button:disabled{opacity:.5;cursor:default}\n' +
  'af-slide-deck [data-af-deck-row]:hover,' +
  'af-slide-deck>[data-af-deck-chrome=toolbar]>button:enabled:hover{background:color-mix(in srgb,' +
  'var(--foreground,gray) 14%,transparent)}\naf-slide-deck [data-af-deck-row]:focus-visible,' +
  'af-slide-deck>[data-af-deck-chrome=toolbar]>button:focus-visible,' +
  'af-slide-deck:focus-visible{outline:2px solid var(--ring,Highlight);outline-offset:2px}\n' +
  'af-slide-deck>[data-af-deck-chrome=status]{position:absolute;clip-path:inset(50%);width:1px;' +
  'height:1px;overflow:hidden}\naf-slide-deck:fullscreen{display:block;overflow:auto}\n' +
  'af-slide-deck:fullscreen>[data-af-deck-chrome=rail]{display:none}\n' +
  'af-slide-deck:fullscreen>af-slide{min-height:100svh}\n' +
  '@media(max-width:720px){af-slide-deck{grid-template-columns:minmax(0,1fr)}' +
  'af-slide-deck>[data-af-deck-chrome=rail]{display:none}af-slide-deck>af-slide{grid-column:1}}\n' +
  '@media print{af-slide-deck{display:block;background:transparent}' +
  'af-slide-deck>[data-af-deck-chrome]{display:none!important}af-slide{display:flex;' +
  'break-after:page;break-inside:avoid;min-height:0}af-slide:last-of-type{break-after:auto}}\n';
