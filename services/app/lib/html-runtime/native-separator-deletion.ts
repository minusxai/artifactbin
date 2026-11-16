/** Join only list siblings exposed by an explicit whole-separator deletion.
 * Position mapping lets structural undo retain subsequent collaborative edits. */
import type { Editor } from '@tiptap/core';
import { NodeSelection } from 'prosemirror-state';
import { structural } from './native-editor-actions';
export function deleteListSeparator(editor:Editor,emptyCaret=false):boolean {
 const {selection}=editor.state;
 let {from,to}=selection;
 if(selection instanceof NodeSelection){if(selection.node.type.name!=='paragraph')return false;}
 else if(emptyCaret&&selection.empty&&selection.$from.depth>0&&selection.$from.parent.type.name==='paragraph'&&!selection.$from.parent.content.size){
  from=selection.$from.before();to=selection.$from.after();
 }else return false;
 const $from=editor.state.doc.resolve(from),index=$from.index(),parent=$from.parent;
 if(index===0||index+1>=parent.childCount)return false;
 const left=parent.child(index-1),right=parent.child(index+1);
 if(left.type!==right.type||!['taskList','bulletList','orderedList'].includes(left.type.name))return false;
 for(const key of Object.keys(left.attrs)){
  if(key==='afId')continue;
  if(key==='start'&&left.type.name==='orderedList'){
   if(right.attrs.start!==left.attrs.start+left.childCount)return false;
  }else if(left.attrs[key]!==right.attrs[key])return false;
 }
 return structural(editor,()=>{
  const tr=editor.state.tr.delete(from,to);
  tr.join(from);editor.view.dispatch(tr.scrollIntoView());return true;
 },pos=>pos>=from&&pos<to?-1:pos>=to?pos-(to-from)-2:pos);
}
