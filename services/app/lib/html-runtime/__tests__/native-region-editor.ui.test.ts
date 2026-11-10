import { afterEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import { TextSelection } from 'prosemirror-state';
import { createRegionState, validateRegionUpdate, regionHtml } from '../../live-regions';
import { mountRegionEditor } from '../native-region-editor';
import type { RegionEditor } from '../region-editor';
const cleanup:Array<()=>void>=[];
afterEach(()=>cleanup.splice(0).forEach(fn=>fn()));
it('real native collaboration undo keeps a peer insertion in the first local text node',()=>{
 const initial=createRegionState('rich-native-v1','<p data-af-id="af-1"></p>');
 let server=initial.state;
 const make=(clientId:number,deliver:(update:Uint8Array)=>void)=>{
  const root=document.createElement('article');document.body.append(root);
  const editor=mountRegionEditor({win:window,root,regionId:'af-region',kind:'rich-native-v1',clientId,state:initial.state,post(message){if(message.kind==='region-update'){const checked=validateRegionUpdate('rich-native-v1',server,message.update,clientId);server=Y.encodeStateAsUpdate(checked.doc);deliver(message.update);}}});
  cleanup.push(()=>{editor.destroy();root.remove();});return editor;
 };
 let b:RegionEditor;
 const a=make(101,update=>b.remote([update]));b=make(102,update=>a.remote([update]));
 a.view.dispatch(a.view.state.tr.insertText('Alice',1));a.flush();
 b.view.dispatch(b.view.state.tr.insertText(' Bob',6));b.flush();
 expect(a.view.state.doc.textContent).toBe('Alice Bob');
 expect(a.command('undo')).toBe(true);a.flush();
 expect(a.view.state.doc.textContent).toBe(' Bob');expect(b.view.state.doc.textContent).toBe(' Bob');
 expect(regionHtml('rich-native-v1',server)).toContain(' Bob');
 a.session(101,server);b.session(102,server);
 expect(a.view.state.doc.toJSON()).toEqual(b.view.state.doc.toJSON());
});

function single(html:string){
 const root=document.createElement('article');document.body.append(root);
 const editor=mountRegionEditor({win:window,root,regionId:'af-region',kind:'rich-native-v1',clientId:501,state:createRegionState('rich-native-v1',html).state,post(){}});
 cleanup.push(()=>{editor.destroy();root.remove();});return editor;
}
function clipboard(plain:string,html=''){
 const event=new Event('paste',{bubbles:true,cancelable:true}) as ClipboardEvent;
 Object.defineProperty(event,'clipboardData',{value:{getData:(type:string)=>type==='text/html'?html:type==='text/plain'?plain:''}});return event;
}
it('native HTML clipboard preserves task checks, marks, links and code language without copied identities',()=>{
 const e=single('<p data-af-id="af-1">Original</p>');
 const html='<ul data-type="taskList"><li data-type="taskItem" data-checked="true" data-af-id="af-1"><p><strong>Done</strong> <a href="https://example.com">link</a></p></li></ul><pre><code class="language-js">const x = 1;</code></pre>';
 e.view.pasteHTML(html,clipboard('Done link\nconst x = 1;',html));
 expect(e.view.state.doc.toJSON()).toMatchObject({content:expect.arrayContaining([expect.objectContaining({type:'taskList',content:[expect.objectContaining({type:'taskItem',attrs:expect.objectContaining({checked:true,afId:null})})]}),expect.objectContaining({type:'codeBlock',attrs:expect.objectContaining({language:'js'})})])});
 expect(e.view.dom.querySelector('strong')?.textContent).toBe('Done');
 expect(e.view.dom.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
});
it('Tab meaningfully indents ordinary text and ShiftTab reverses it instead of advancing focus',()=>{
 const e=single('<p>First</p><p>Second</p>');
 e.view.focus();
 const tab=new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});
 e.view.dom.dispatchEvent(tab);
 expect(tab.defaultPrevented).toBe(true);expect(e.view.state.doc.firstChild?.textContent).toBe('  First');
 e.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
 expect(e.view.state.doc.firstChild?.textContent).toBe('First');
});
it('saved code language produces presentation tokens without changing editor text',()=>{
 const e=single('<pre><code class="language-js">const x = 1;</code></pre>');
 expect(e.view.dom.querySelector('[class*="token"]')).not.toBeNull();
 expect(e.view.state.doc.textContent).toBe('const x = 1;');
 expect(JSON.stringify(e.view.state.doc.toJSON())).not.toContain('token');
});
it('code paste is literal, while explicit plain paste drops clipboard formatting',()=>{
 const code=single('<pre><code class="language-js"></code></pre>');
 code.view.pasteText('**literal**\n- text',clipboard('**literal**\n- text'));
 expect(code.view.state.doc.firstChild?.textContent).toBe('**literal**\n- text');
 expect(code.view.state.doc.childCount).toBe(1);
 const plain=single('<p></p>');
 plain.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'V',shiftKey:true,metaKey:true,bubbles:true}));
 plain.view.pasteText('**literal**',clipboard('**literal**'));
 expect(plain.view.state.doc.textContent).toBe('**literal**');
 expect(plain.view.dom.querySelector('strong')).toBeNull();
});
it('unsafe HTML links are dropped by the supported native schema',()=>{
 const e=single('<p></p>');const html='<p><a href="javascript:alert(1)">unsafe</a></p>';
 e.view.pasteHTML(html,clipboard('unsafe',html));
 expect(e.view.state.doc.textContent).toBe('unsafe');expect(e.view.dom.querySelector('a')).toBeNull();
});

it('first list item fallback indentation reverses without losing list structure',()=>{
 const e=single('<ul><li><p>First</p></li><li><p>Second</p></li></ul>');
 e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc,3)));
 e.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
 expect(e.view.state.doc.firstChild?.firstChild?.textContent).toBe('  First');
 e.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
 expect(e.view.state.doc.firstChild?.type.name).toBe('bulletList');
 expect(e.view.state.doc.firstChild?.firstChild?.textContent).toBe('First');
});
it('multi-paragraph indentation is undoable and redoable',()=>{
 const e=single('<p>One</p><p>Two</p>');
 e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc,1,9)));
 e.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
 expect(e.view.state.doc.textContent).toBe('  One  Two');
 e.command('undo');expect(e.view.state.doc.textContent).toBe('OneTwo');
 e.command('redo');expect(e.view.state.doc.textContent).toBe('  One  Two');
});
it('Enter splits list items and Backspace rejoins without losing content',()=>{
 const e=single('<ul><li><p>OneTwo</p></li></ul>');
 e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc,6)));
 e.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
 expect(e.view.state.doc.firstChild?.childCount).toBe(2);
 expect(e.view.state.doc.textContent).toBe('OneTwo');
 e.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace',bubbles:true,cancelable:true}));
 expect(e.view.state.doc.firstChild?.childCount).toBe(1);
 expect(e.view.state.doc.textContent).toBe('OneTwo');
});
it('mixed native Markdown paste validates at the authenticated update boundary',async()=>{
 const { nativeMarkdownJson }=await import('../../live-regions/native-markdown');
 const initial=createRegionState('rich-native-v1','<h1>Before</h1><p>Text</p>');
 const root=document.createElement('article');document.body.append(root);
 let refused:unknown;
 const e=mountRegionEditor({win:window,root,regionId:'af-region',kind:'rich-native-v1',clientId:602,state:initial.state,post(message){if(message.kind==='region-update'){try{validateRegionUpdate('rich-native-v1',initial.state,message.update,602);}catch(error){refused=error;}}}});
 cleanup.push(()=>{e.destroy();root.remove();});
 const json=nativeMarkdownJson('# Title\n\n- One\n- Two\n\n- [x] Done\n- [ ] Next\n\n```js\nconst x = 1;\n```\n\n**Bold** and [link](https://example.com)');
 const parsed=e.view.state.schema.nodeFromJSON(json);
 e.view.dispatch(e.view.state.tr.replaceWith(0,e.view.state.doc.content.size,parsed.content));e.flush();
 expect(refused).toBeUndefined();
});
