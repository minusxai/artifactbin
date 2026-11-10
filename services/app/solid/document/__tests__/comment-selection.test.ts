import {afterEach,expect,it,vi} from 'vitest';
import {TextSelection} from 'prosemirror-state';
import {mountCommentEditor} from '../comment-editor';
import {fireEvent} from '../../__tests__/helpers';
const cleanup:Array<()=>void>=[];
afterEach(()=>cleanup.splice(0).forEach(fn=>fn()));
it('indents every selected comment list item and outdents without losing text',()=>{
 const root=document.createElement('div');document.body.append(root);
 const editor=mountCommentEditor(root,{value:()=>'- parent\n- child one\n- child two',label:'Comment',onChange:vi.fn(),onMention:vi.fn(),onKey:()=>false});
 cleanup.push(()=>{editor.destroy();root.remove()});
 let from=0,to=0;
 editor.view.state.doc.descendants((node,pos)=>{if(node.isText&&node.text==='child one')from=pos;if(node.isText&&node.text==='child two')to=pos+node.nodeSize});
 editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc,from,to)));
 fireEvent.keyDown(editor.view.dom,{key:'Tab'});
 expect([...editor.view.dom.querySelectorAll('ul ul li')].map(el=>el.textContent)).toEqual(['child one','child two']);
 fireEvent.keyDown(editor.view.dom,{key:'Tab',shiftKey:true});
 expect(editor.view.dom.querySelector('ul ul')).toBeNull();
 expect([...editor.view.dom.querySelectorAll('li')].map(el=>el.textContent)).toEqual(['parent','child one','child two']);
});
