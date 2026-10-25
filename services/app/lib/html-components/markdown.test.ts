// @vitest-environment jsdom
import {afterEach,expect,it} from 'vitest';
import {AfMarkdown,registerMarkdown,type MarkdownContract} from './markdown';
import { MARKDOWN_CSS } from '../markdown/styles';
registerMarkdown();
afterEach(()=>document.body.replaceChildren());
it('renders retained GFM with stable headings, highlighting and preserved authored identity',()=>{
 const el=document.createElement('af-markdown') as AfMarkdown; el.textContent='# Hello\n\n~~gone~~\n\n```js\nconst x = 1\n```'; el.setAttribute('data-af-id','author'); document.body.append(el);
 expect(el.querySelector('s')?.textContent).toBe('gone'); expect(el.querySelector('.mx-code-token-keyword')).not.toBeNull(); const id=el.querySelector('h1')?.id;
 el.source='# Hello\n\nUpdated'; expect(el.querySelector('h1')?.id).toBe(id); expect(el.getAttribute('data-af-id')).toBe('author'); expect(el.shadowRoot).toBeNull(); const contract:MarkdownContract=el; expect(contract.source).toContain('Updated');
});
it('refuses unsafe links and unsupported HTML through the existing vocabulary',()=>{
 const el=document.createElement('af-markdown') as AfMarkdown; document.body.append(el); el.source='[bad](javascript:alert(1))'; expect(el.querySelector('a')).toBeNull(); expect(el.querySelector('[role=alert]')).not.toBeNull();
 el.source='<img src=x onerror=alert(1)>'; expect(el.querySelector('img')).toBeNull();
});
it('preserves authored nodes outside its generated output',()=>{
 const el=document.createElement('af-markdown') as AfMarkdown; const note=document.createElement('aside'); note.setAttribute('data-af-id','note'); el.append(note); document.body.append(el); el.source='# Heading'; expect(el.querySelector('aside')).toBe(note);
});
it('uses reader typography and themed copy controls without overriding shared table geometry',()=>{
 const el=document.createElement('af-markdown') as AfMarkdown;el.source='# Heading\n\n| Name | Value |\n| --- | --- |\n| short | 1 |\n\n```js\nconst value = 1\n```';document.body.append(el);
 expect(MARKDOWN_CSS).toContain('font-family: var(--font-display, inherit)');
 expect(MARKDOWN_CSS).toContain('font-family: var(--font-mono, monospace)');
 expect(MARKDOWN_CSS).toContain('.dark .mx-markdown');
 expect(getComputedStyle(el.querySelector('h1')!).fontFamily).toContain('--font-display');
 expect(getComputedStyle(el.querySelector('h1')!).marginBlockStart).toBe('0px');
 expect(getComputedStyle(el.querySelector('table')!).width).toBe('fit-content');
 expect(getComputedStyle(el.querySelector('th')!).textAlign).toBe('start');
 expect(getComputedStyle(el.querySelector('button')!).color).toContain('--foreground');
 expect(document.querySelector<HTMLStyleElement>('style[data-af-markdown-styles]')!.textContent).toContain('background:var(--background,Canvas)');
 expect(document.querySelector<HTMLStyleElement>('style[data-af-markdown-styles]')!.textContent).toContain('border:1px solid var(--border');
 expect(document.querySelector<HTMLStyleElement>('style[data-af-markdown-styles]')!.textContent).toContain('outline:2px solid var(--ring,Highlight)');
 expect(document.querySelector<HTMLStyleElement>('style[data-af-markdown-styles]')!.textContent).toContain('min-width: 6em');
 expect(document.querySelector<HTMLStyleElement>('style[data-af-markdown-styles]')!.textContent).toContain('padding: .5em .75em');
 expect(getComputedStyle(el.querySelector('table')!).overflowX).toBe('auto');
 expect(document.querySelector<HTMLStyleElement>('style[data-af-markdown-styles]')!.textContent).toContain('af-markdown .mx-markdown > :first-child{margin-block-start:0}');
 expect(document.querySelector<HTMLStyleElement>('style[data-af-markdown-styles]')!.textContent).not.toContain('padding:1rem;background:var(--muted');
 expect(el.querySelector('table')?.parentElement?.classList.contains('mx-md-table-scroll')).toBe(true);
 expect(el.querySelector('th')?.textContent).toBe('Name');
 expect(el.querySelector('button')?.textContent).toBe('Copy code');
});
it('defaults copy controls on, but supports an explicit opt-out across rerender and reconnect',()=>{
 const el=document.createElement('af-markdown') as AfMarkdown;
 el.source='```js\nconst first = 1\n```';document.body.append(el);
 const initial=el.querySelector('button');expect(initial?.textContent).toBe('Copy code');
 el.setAttribute('copy-controls','false');expect(el.querySelector('button')).toBeNull();expect(initial?.isConnected).toBe(false);
 el.source='```js\nconst second = 2\n```';expect(el.querySelector('button')).toBeNull();
 el.removeAttribute('copy-controls');expect(el.querySelector('button')?.textContent).toBe('Copy code');
 el.copyControls=false;expect(el.getAttribute('copy-controls')).toBe('false');expect(el.querySelector('button')).toBeNull();
 el.remove();el.source='```js\nconst third = 3\n```';document.body.append(el);expect(el.querySelector('button')).toBeNull();
 el.copyControls=true;expect(el.hasAttribute('copy-controls')).toBe(false);expect(el.querySelector('button')?.textContent).toBe('Copy code');
});
it('keeps reader Markdown styling inside the custom element',()=>{
 const sibling=document.createElement('div');sibling.className='mx-markdown';const heading=document.createElement('h1');heading.textContent='Independent sibling';sibling.append(heading);document.body.append(sibling);
 expect(getComputedStyle(heading).fontFamily).not.toContain('--font-display');
 expect(getComputedStyle(heading).fontSize).not.toBe('2.25em');
});
it('uses the reader dark code palette under the platform dark-theme attribute',()=>{
 const prior=document.documentElement.getAttribute('data-af-dark');const el=document.createElement('af-markdown') as AfMarkdown;el.source='```js\nconst value = 1\n```';document.documentElement.setAttribute('data-af-dark','true');document.body.append(el);
 try{expect(getComputedStyle(el.querySelector('.mx-markdown')!).getPropertyValue('--mx-code-keyword').trim()).toBe('#d2a8ff');}
 finally{if(prior===null)document.documentElement.removeAttribute('data-af-dark');else document.documentElement.setAttribute('data-af-dark',prior);}
});
it('reports unavailable and rejected clipboard access explicitly',async()=>{
 const el=document.createElement('af-markdown') as AfMarkdown;el.source='```js\nconst x = 1\n```';document.body.append(el);
 const original=Object.getOwnPropertyDescriptor(navigator,'clipboard');
 try {
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});el.querySelector('button')!.click();expect(el.querySelector('button')!.textContent).toBe('Copy unavailable');
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('denied'))}});el.source=el.source;el.querySelector('button')!.click();await Promise.resolve();await Promise.resolve();expect(el.querySelector('button')!.textContent).toBe('Copy unavailable');
 } finally {if(original)Object.defineProperty(navigator,'clipboard',original);else Reflect.deleteProperty(navigator,'clipboard');}
});
it('uses the owning document clipboard after adoption',async()=>{
 const iframe=document.createElement('iframe');document.body.append(iframe);const doc=iframe.contentDocument!;
 const el=document.createElement('af-markdown') as AfMarkdown;el.source='```\ncopy this\n```';doc.adoptNode(el);doc.body.append(el);
 let copied='';Object.defineProperty(doc.defaultView!.navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{copied=text;}}});el.querySelector('button')!.click();await Promise.resolve();expect(copied).toBe('copy this');expect(el.querySelector('button')!.textContent).toBe('Copied');expect(el.querySelector('button')!.ownerDocument).toBe(doc);
});

it('preserves reader preflight and bare prose rhythm without shifting code for its copy affordance',()=>{
 const el=document.createElement('af-markdown') as AfMarkdown;el.source='# Heading\n\nParagraph\n\n> Quoted\n\n```js\nconst x = 1\n```\n\n| Region | Count |\n| --- | --- |\n| North | 12 |';document.body.append(el);
 const quote=getComputedStyle(el.querySelector('blockquote')!),pre=getComputedStyle(el.querySelector('pre')!),copy=getComputedStyle(el.querySelector('button')!),cell=getComputedStyle(el.querySelector('td')!),table=getComputedStyle(el.querySelector('table')!);
 expect(parseFloat(quote.marginLeft)).toBe(0);expect(quote.maxWidth).toBe('544px');expect(quote.borderInlineStart).toBe('3px solid currentcolor');
 expect(pre.fontSize).toBe('16px');expect(pre.maxWidth).toBe('544px');expect(copy.position).toBe('absolute');expect(copy.opacity).toBe('0');
 expect(cell.paddingTop).toBe('6.4px');expect(table.width).toBe('fit-content');expect(table.maxWidth).toBe('100%');expect(el.querySelector('button')!.textContent).toBe('Copy code');
});
