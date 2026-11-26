// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {AfMarkdown,type MarkdownContract} from './markdown';
import './markdown';
import { MARKDOWN_CSS } from './markdown-styles';
import { parse, renderHtml } from '../markdown/display';
afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks();});
it('renders retained GFM with stable headings, highlighting and preserved authored identity',()=>{
 const el=document.createElement('af-markdown') as AfMarkdown; el.textContent='# Hello\n\n~~gone~~\n\n```js\nconst x = 1\n```'; el.setAttribute('data-af-id','author'); document.body.append(el);
 expect(el.querySelector('s')?.textContent).toBe('gone'); expect(el.querySelector('.mx-code-token-keyword')).not.toBeNull(); const id=el.querySelector('h1')?.id;
 el.source='# Hello\n\nUpdated'; expect(el.querySelector('h1')?.id).toBe(id); expect(el.getAttribute('data-af-id')).toBe('author'); expect(el.shadowRoot).toBeNull(); const contract:MarkdownContract=el; expect(contract.source).toContain('Updated');
});
it('shows a refused link as typed and warns once per render, never hiding the text behind an alert',()=>{
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 const el=document.createElement('af-markdown') as AfMarkdown; document.body.append(el); warn.mockClear();
 el.source='Before [bad](javascript:alert(1)) and ![pic](http://insecure.example/a.png) after **bold**';
 expect([...el.querySelectorAll('a')].map(a=>a.getAttribute('href'))).toEqual(['http://insecure.example/a.png']); expect(el.querySelector('img')).toBeNull(); expect(el.querySelector('[role=alert]')).toBeNull();
 expect(el.querySelector('p')?.textContent).toBe('Before [bad](javascript:alert(1)) and ![pic](http://insecure.example/a.png) after bold');
 expect(el.querySelector('strong')?.textContent).toBe('bold');
 expect(warn).toHaveBeenCalledTimes(1);
 expect(String(warn.mock.calls[0]![0])).toContain('[bad](javascript:alert(1))');
 expect(String(warn.mock.calls[0]![0])).toContain('![pic](http://insecure.example/a.png)');
 el.source='[bad](javascript:alert(1))'; expect(el.querySelector('a')).toBeNull(); expect(warn).toHaveBeenCalledTimes(2);
 el.source='# Fine [ok](https://a.example)'; expect(warn).toHaveBeenCalledTimes(2); expect(el.querySelector('a')?.getAttribute('href')).toBe('https://a.example');
});
it('shows raw HTML as literal text, never as markup',()=>{
 const el=document.createElement('af-markdown') as AfMarkdown; document.body.append(el);
 el.source='<img src=x onerror=alert(1)> <script>alert(1)</script>';
 expect(el.querySelector('img,script')).toBeNull(); expect(el.querySelector('[role=alert]')).toBeNull();
 expect(el.querySelector('p')?.textContent).toBe('<img src=x onerror=alert(1)> <script>alert(1)</script>');
});
it('renders through the shared Markdown display entry, images on and a single newline as a break',()=>{
 const source='# Title\n\none\ntwo\n\n- [x] done\n- [ ] open\n\n![A chart](https://img.example/c.png "Chart")\n\n| a | b |\n| - | -: |\n| 1 | 2 |';
 const el=document.createElement('af-markdown') as AfMarkdown; el.id='doc'; el.copyControls=false; el.source=source; document.body.append(el);
 const output=el.querySelector('.af-markdown-body')!;
 const expected=document.createElement('div'); expected.innerHTML=renderHtml(parse(source,{images:true}));
 expected.querySelectorAll<HTMLElement>('[data-mx-markdown-heading]').forEach(h=>{h.id=`doc-heading-${h.dataset.mxMarkdownHeading}`;});
 expect(output.innerHTML).toBe(expected.innerHTML);
 expect(el.querySelector('p br')).not.toBeNull();
 const img=el.querySelector('img')!; expect(img.getAttribute('src')).toBe('https://img.example/c.png'); expect(img.alt).toBe('A chart'); expect(img.title).toBe('Chart'); expect(img.getAttribute('loading')).toBe('lazy');
 expect([...el.querySelectorAll('li[role=checkbox]')].map(li=>li.getAttribute('aria-checked'))).toEqual(['true','false']);
});
it('anchors headings 1-3 as ${id||scope}-heading-N in document order',()=>{
 const named=document.createElement('af-markdown') as AfMarkdown; named.id='notes'; named.source='# A\n\n## B\n\n#### C\n\n### D'; document.body.append(named);
 expect([...named.querySelectorAll('h1,h2,h3,h4')].map(h=>h.id)).toEqual(['notes-heading-0','notes-heading-1','','notes-heading-2']);
 const anonymous=document.createElement('af-markdown') as AfMarkdown; anonymous.source='## Only'; document.body.append(anonymous);
 expect(anonymous.querySelector('h2')!.id).toMatch(/^af-markdown-\d+-heading-0$/);
});
it('emits no events while rendering, updating or reconnecting',()=>{
 const dispatch=vi.spyOn(EventTarget.prototype,'dispatchEvent');
 try {
  const el=document.createElement('af-markdown') as AfMarkdown; el.textContent='# One\n\n```js\nconst a = 1\n```'; document.body.append(el);
  el.source='## Two [x](javascript:y)'; el.setAttribute('copy-controls','false'); el.remove(); document.body.append(el);
  expect(dispatch.mock.contexts.filter(target=>target instanceof Node&&(target===el||el.contains(target)))).toEqual([]);
 } finally { dispatch.mockRestore(); }
});
it('renders hostile nesting and emphasis runs without hanging, keeping their text',()=>{
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 const el=document.createElement('af-markdown') as AfMarkdown; document.body.append(el);
 for(const source of ['- '.repeat(2000)+'deepest','> '.repeat(5000)+'deepest','*a'.repeat(20000)+' deepest','[a](b'.repeat(5000)+' deepest']){
  el.source=source; expect(el.querySelector('.af-markdown-body')!.textContent,source.slice(0,12)).toContain('deepest');
 }
 expect(warn).not.toHaveBeenCalled();
},20000);
it('preserves authored nodes outside its generated output',()=>{
 const el=document.createElement('af-markdown') as AfMarkdown; const note=document.createElement('aside'); note.setAttribute('data-af-id','note'); el.append(note); document.body.append(el); el.source='# Heading'; expect(el.querySelector('aside')).toBe(note);
});
it('uses the shared Markdown typography and themed copy controls',()=>{
 const el=document.createElement('af-markdown') as AfMarkdown;el.source='# Heading\n\n| Name | Value |\n| --- | --- |\n| short | 1 |\n\n```js\nconst value = 1\n```';document.body.append(el);
 expect(MARKDOWN_CSS).toContain('font-family:var(--font-display,inherit)');
 expect(MARKDOWN_CSS).toContain('font-family:var(--font-mono,');
 expect(MARKDOWN_CSS).toContain('[data-af-dark="true"]');
 expect(getComputedStyle(el.querySelector('h1')!).fontFamily).toContain('--font-display');
 expect(parseFloat(getComputedStyle(el.querySelector('h1')!).marginBlockStart)).toBe(0);
 expect(getComputedStyle(el.querySelector('table')!).width).toBe('fit-content');
 expect(getComputedStyle(el.querySelector('th')!).textAlign).toBe('start');
 expect(getComputedStyle(el.querySelector('button')!).color).toContain('--foreground');
 expect(document.querySelector<HTMLStyleElement>('style[data-af-markdown-styles]')!.textContent).toContain('background:var(--background,Canvas)');
 expect(document.querySelector<HTMLStyleElement>('style[data-af-markdown-styles]')!.textContent).toContain('border:1px solid var(--border');
 expect(document.querySelector<HTMLStyleElement>('style[data-af-markdown-styles]')!.textContent).toContain('outline:2px solid var(--ring,Highlight)');
 expect(getComputedStyle(el.querySelector('table')!).overflowX).toBe('auto');
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
it('styles only a Markdown root, not a look-alike class outside it',()=>{
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

it('draws quotes and lists with the browser indent a doc editor uses, and code without shifting for its copy affordance',()=>{
 const el=document.createElement('af-markdown') as AfMarkdown;el.source='# Heading\n\nParagraph\n\n> Quoted\n\n```js\nconst x = 1\n```\n\n| Region | Count |\n| --- | --- |\n| North | 12 |';document.body.append(el);
 const quote=getComputedStyle(el.querySelector('blockquote')!),copy=getComputedStyle(el.querySelector('button')!),table=getComputedStyle(el.querySelector('table')!);
 expect(parseFloat(quote.marginBlockStart)).toBe(0);expect(parseFloat(quote.marginLeft||'0')).toBe(0);expect(quote.color).toContain('--muted-foreground');
 expect(copy.position).toBe('absolute');expect(copy.opacity).toBe('0');expect(getComputedStyle(el.querySelector('pre')!).position).toBe('relative');
 expect(el.querySelector('pre code')?.className).toMatch(/^language-/);
 expect(table.width).toBe('fit-content');expect(table.maxWidth).toBe('100%');expect(el.querySelector('button')!.textContent).toBe('Copy code');
});
