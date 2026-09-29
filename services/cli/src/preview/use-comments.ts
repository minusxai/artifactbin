/** Local storage meets the shared runtime's annotation protocol at this boundary. */
import {useEffect,useMemo,useState} from 'react';
import type {JsxNode} from '../../../app/lib/jsx';
import {isEditFrameMessage,STORY_ANNOTATIONS_MESSAGE,STORY_SELECTION_ACTIONS_MESSAGE,type StoryController,type StoryEditSelection,type StoryEditRect,type StoryAnnotationsMessage} from '../../../app/lib/story-runtime/contract';
import type {PreviewComment} from './comments';

function bodyAnchors(nodes:JsxNode[],prefix=''):Map<string,string>{
 const result=new Map<string,string>();
 nodes.forEach((node,index)=>{
  if(node.type!=='element')return;
  const path=prefix?`${prefix}.${index}`:String(index);
  const id=node.attributes.find(attribute=>attribute.name==='id')?.value;
  if(id?.static&&typeof id.json==='string')result.set(id.json,path);
  for(const [key,value] of bodyAnchors(node.children,path))result.set(key,value);
 });
 return result;
}
export function usePreviewComments({controller,nodes,comments,visible}:{controller:StoryController|null;nodes:JsxNode[];comments:PreviewComment[];visible:boolean}){
 const [open,setOpen]=useState(false),[picking,setPicking]=useState(false),[selection,setSelection]=useState<StoryEditSelection|null>(null),[active,setActive]=useState<string|null>(null);
 const [positions,setPositions]=useState<Array<{id:string;rect:StoryEditRect}>>([]);
 const anchors=useMemo(()=>bodyAnchors(nodes),[nodes]);
 useEffect(()=>controller?.subscribe(event=>{
  if(!isEditFrameMessage(event,controller.nonce))return;
  if(event.type==='mx:selection'&&picking&&event.selection){setSelection(event.selection);setPicking(false);setOpen(true);setActive(null);}
  if(event.type==='mx:selection-action'&&event.action==='annotate'){setSelection(event.selection);setPicking(false);setOpen(true);setActive(null);}
  if(event.type==='mx:annotation-pin'){setActive(event.id);setOpen(true);setSelection(null);}
  if(event.type==='mx:annotation-layout')setPositions(event.positions);
 }),[controller,picking]);
 useEffect(()=>{
  const command:StoryAnnotationsMessage={type:STORY_ANNOTATIONS_MESSAGE,mode:visible?'on':'off',canComment:true,pins:comments.flatMap(comment=>{
   const path=anchors.get(comment.node);return path===undefined?[]:[{id:comment.id,nodeId:comment.node,path,key:null,range:comment.range}];
  }),openId:active,hoverId:null,pick:picking?'select':null,selected:selection,selectedPath:selection?.path??null};
  controller?.send(command);
 },[controller,comments,anchors,active,picking,selection,visible]);
 useEffect(()=>{controller?.send({type:STORY_SELECTION_ACTIONS_MESSAGE,edit:false,annotate:visible});},[controller,visible]);
 return {open,setOpen,picking,setPicking,selection,setSelection,active,setActive,positions,anchors};
}
