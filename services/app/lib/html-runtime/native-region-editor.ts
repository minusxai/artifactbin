/** Opt-in native editor chunk. Credentials and HTTP remain exclusively in the trusted parent. */
import { Editor } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import { NativeIndentation, freshClipboard, indentText } from './native-editing-behavior';
import { NativeCodePresentation } from './native-code-presentation';
import { Slice } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey, yUndoPluginKey } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { nativeExtensions, NATIVE_ROOT, openRegionDoc } from '../live-regions/native-browser';
import { createRegionCaretPainter } from '../html-bridge/region-carets';
import type { RegionEditor, RegionEditorOptions } from './region-editor';
// Markdown is loaded only on paste; keep its parser out of the typing/collaboration chunk.
const MARKDOWN_MODULE='@afbin/native-markdown';
const REMOTE=Symbol('native-remote');
const base64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));
export function mountRegionEditor(options:RegionEditorOptions):RegionEditor {
 const {root,post,regionId}=options;
 let clientId=options.clientId;
 const doc=openRegionDoc(options.state,{kind:'rich-native-v1',clientId});
 const fragment=doc.getXmlFragment(NATIVE_ROOT);
 const previous=root.innerHTML;
 root.replaceChildren();root.setAttribute('data-af-region-editor','rich-native-v1');
 let pending:Uint8Array[]=[];let held:Uint8Array[]=[];let timer:ReturnType<typeof setTimeout>|undefined;let destroyed=false;
 let editor: Editor;
 let plainPaste=false;
 let painter:ReturnType<typeof createRegionCaretPainter>|undefined;
 const flush=()=>{if(timer)clearTimeout(timer);timer=undefined;if(destroyed||editor.view.composing||!pending.length)return;post({kind:'region-update',regionId,update:Y.mergeUpdates(pending)});pending=[];};
 doc.on('update',(update:Uint8Array,origin:unknown)=>{if(origin!==REMOTE){pending.push(update);timer??=setTimeout(flush,50);}});
 const encode=(pos:number)=>{const sync=ySyncPluginKey.getState(editor.state);return base64(Y.encodeRelativePosition(absolutePositionToRelativePosition(pos,fragment,sync!.binding.mapping)));};
 const decode=(_state:unknown,position:string)=>{try{if(position.length>344)return null;const sync=ySyncPluginKey.getState(editor.state);return relativePositionToAbsolutePosition(doc,fragment,Y.decodeRelativePosition(Uint8Array.from(atob(position),c=>c.charCodeAt(0))),sync!.binding.mapping);}catch{return null;}};
 const caret=()=>{if(!editor?.view.hasFocus() || !ySyncPluginKey.getState(editor.state))return;const s=editor.state.selection;post({kind:'region-caret',regionId,anchor:encode(s.anchor),head:encode(s.head),marks:s.$head.marks().map(m=>m.type.name==='bold'?'strong':m.type.name==='italic'?'em':m.type.name),block:s.$head.parent.type.name==='heading'?`h${s.$head.parent.attrs.level}`:'paragraph'});};
 const apply=(updates:readonly Uint8Array[])=>{if(updates.length)Y.applyUpdate(doc,Y.mergeUpdates([...updates]),REMOTE);doc.clientID=clientId;};
 editor=new Editor({element:root,extensions:[...nativeExtensions(),NativeIndentation,NativeCodePresentation,Collaboration.configure({document:doc,field:NATIVE_ROOT})],
  editorProps:{transformPasted:freshClipboard,handlePaste(view,event){if(plainPaste){const text=event.clipboardData?.getData('text/plain');if(text===undefined)return false;view.dispatch(view.state.tr.insertText(text));return true;}if(event.clipboardData?.getData('text/html')||view.state.selection.$from.parent.type.spec.code)return false;const text=event.clipboardData?.getData('text/plain');if(text===undefined)return false;const anchor=encode(view.state.selection.from),head=encode(view.state.selection.to);
   void import(/* @vite-ignore */ MARKDOWN_MODULE).then((module:typeof import('./native-region-markdown'))=>{
    if(destroyed)return;const from=decode(view.state,anchor),to=decode(view.state,head);if(from===null||to===null)return;
    const parsed=view.state.schema.nodeFromJSON(module.nativeMarkdownJson(text));
    const undo=yUndoPluginKey.getState(view.state)?.undoManager;undo?.stopCapturing();
    view.dispatch(view.state.tr.replaceRange(from,to,new Slice(parsed.content,1,1)));undo?.stopCapturing();
   }).catch(()=>{if(!destroyed){const from=decode(view.state,anchor),to=decode(view.state,head);if(from!==null&&to!==null)view.dispatch(view.state.tr.insertText(text,from,to));}});
   return true;},attributes:{'data-af-region-editor':'rich-native-v1'},handleDOMEvents:{keydown:(_,event)=>{plainPaste=event.shiftKey;return false;},keyup:()=>{plainPaste=false;return false;},compositionend:()=>{setTimeout(()=>{apply(held);held=[];flush();},0);return false;},blur:()=>{post({kind:'region-blur'});return false;}}},
  onSelectionUpdate:()=>caret(),onUpdate:()=>{painter?.refresh();caret();},
 });
 const view=editor.view;
 painter=createRegionCaretPainter(view,regionId,decode);
 if(!root.ownerDocument.querySelector('[data-af-native-editor-style]')){
  const style=root.ownerDocument.createElement('style');style.setAttribute('data-af-native-editor-style','');style.textContent=`[data-af-region-editor="rich-native-v1"] .tiptap{outline:none;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.5}[data-af-region-editor="rich-native-v1"] ul,[data-af-region-editor="rich-native-v1"] ol{padding-left:28px}[data-af-region-editor="rich-native-v1"] li{margin-block:4px}[data-af-region-editor="rich-native-v1"] li>p,[data-af-region-editor="rich-native-v1"] li>div>p{margin:0}[data-af-region-editor="rich-native-v1"] li ul,[data-af-region-editor="rich-native-v1"] li ol{margin-block:0}[data-af-region-editor="rich-native-v1"] ul[data-type="taskList"]{list-style:none}[data-af-region-editor="rich-native-v1"] ul[data-type="taskList"]>li{display:flex;gap:.5em}[data-af-region-editor="rich-native-v1"] ul[data-type="taskList"]>li>div{flex:1}[data-af-region-editor="rich-native-v1"] pre{white-space:pre-wrap;padding:1em;background:var(--muted,#f4f4f5);border-radius:6px}`;root.ownerDocument.head.append(style);
 }
 if(options.at!==undefined){const at=options.at&&view.posAtCoords({left:options.at.x,top:options.at.y});if(at)view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at.pos))));if(options.focus!==false)view.focus();}
 if(options.caret){const a=decode(view.state,options.caret.anchor),h=decode(view.state,options.caret.head);if(a!==null&&h!==null)view.dispatch(view.state.tr.setSelection(TextSelection.between(view.state.doc.resolve(a),view.state.doc.resolve(h))));view.focus();}
 return {view,flush,
  session(id,state){clientId=id;doc.clientID=id;if(view.composing)held.push(state);else apply([state]);},
  remote(updates){if(view.composing)held.push(...updates);else apply(updates);},
  command(name,args={}){
   const c=editor.commands;let done=false;
   if(name==='strong')done=c.toggleBold();else if(name==='em')done=c.toggleItalic();else if(name==='code')done=c.toggleCode();else if(name==='undo')done=c.undo();else if(name==='redo')done=c.redo();
   else if(name==='list')done=args.type==='ordered'?c.toggleOrderedList():c.toggleBulletList();
   else if(name==='indent')done=c.sinkListItem(editor.isActive('taskItem')?'taskItem':'listItem')||indentText(view.state,view.dispatch);else if(name==='outdent')done=indentText(view.state,view.dispatch,true)||c.liftListItem(editor.isActive('taskItem')?'taskItem':'listItem');
   else if(name==='heading'&&Number.isInteger(args.level)&&Number(args.level)>=1&&Number(args.level)<=6)done=c.toggleHeading({level:args.level as 1|2|3|4|5|6});
   else if(name==='paragraph')done=c.setParagraph();else if(name==='quote')done=c.toggleBlockquote();else if(name==='codeBlock')done=c.toggleCodeBlock();else if(name==='rule')done=c.setHorizontalRule();
   else if(name==='link')done=args.href===null?c.unsetLink():typeof args.href==='string'&&c.setLink({href:args.href});
   else if(name==='resume'||name==='focus'){view.focus();done=true;}
   view.focus();return done;
  },
  replay(entries){for(const entry of entries){if('text' in entry){for(const char of entry.text){const {from,to}=view.state.selection;const insert=()=>view.state.tr.insertText(char,from,to);if(!view.someProp('handleTextInput',fn=>fn(view,from,to,char,insert)))view.dispatch(insert());}}else {const event=new KeyboardEvent('keydown',{...entry,bubbles:true,cancelable:true});view.someProp('handleKeyDown',fn=>fn(view,event));}}},
  paint(carets){painter?.paint(carets);},owns:node=>!!painter?.owns(node),caret(){if(!view.hasFocus())return null;return {anchor:encode(view.state.selection.anchor),head:encode(view.state.selection.head)};},
  destroy(){flush();destroyed=true;if(timer)clearTimeout(timer);painter?.dispose();editor.destroy();doc.destroy();root.removeAttribute('data-af-region-editor');root.innerHTML=previous;},
 };
}
