// @vitest-environment jsdom
import {afterEach,expect,it} from 'vitest';
import {AfMarkdown,registerMarkdown,type MarkdownContract} from './markdown';
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
