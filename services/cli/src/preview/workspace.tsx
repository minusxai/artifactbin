/** Production document chrome with a file-backed ArtifactBackend. No preview-specific editor widgets. */
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {EditorStoryRuntime,type StoryController} from '../../../app/lib/story-runtime/EditorStoryRuntime';
import {ArtifactBackendProvider} from '../../../app/lib/artifact-backend/context';
import ArtifactEditor from '../../../app/components/ArtifactEditor';
import AnnotationLayer from '../../../app/components/AnnotationLayer';
import {InlineReaderChrome} from '../../../app/components/InlineReaderChrome';
import {TrustedUi} from '../../../app/components/TrustedUi';
import {useIsPhoneViewport} from '../../../app/components/MobileSheet';
import {useWideEditViewport} from '../../../app/lib/story/use-edit-panel';
import {APP_BAR_H,EDIT_BAR_H,RIGHT_RAIL_W} from '../../../app/lib/story/edit-bar';
import type {EditorFlushRef} from '../../../app/lib/story/use-live-edits';
import type {AnnotationWire} from '../../../app/lib/annotations';
import type {PreparedStoryRuntime} from '../../../app/lib/story/prepared-runtime';
import {STORY_DOCUMENT_MESSAGE,STORY_SELECTION_ACTIONS_MESSAGE,isEditFrameMessage,type StoryEditSelection,type StoryIslandData} from '../../../app/lib/story-runtime/contract';
import {createPreviewBackend} from './backend';

export interface PreviewDocument {body:string;revision:string;data:StoryIslandData;prepared?:PreparedStoryRuntime;metadata?:{id?:string;title?:string|null}}
export function PreviewWorkspace({initial,file,capture=false}:{initial:PreviewDocument;file:string;capture?:boolean}){
 const runtimeRef=useRef<StoryController|null>(null),editorFlush:EditorFlushRef=useRef(null);
 const [document,setDocument]=useState(initial),[nonce,setNonce]=useState<string|null>(null),[editing,setEditing]=useState(!capture);
 const [railOpen,setRailOpen]=useState(false),[annotation,setAnnotation]=useState<StoryEditSelection|null>(null),[count,setCount]=useState(0);
 const [commentsHost,setCommentsHost]=useState<HTMLElement|null>(null),[titleHost,setTitleHost]=useState<HTMLElement|null>(null),[panelWidth,setPanelWidth]=useState(0);
 const [error,setError]=useState(''),[ready,setReady]=useState(!initial.data.dataflow?.flow.queries.length);
 const phone=useIsPhoneViewport(),wide=useWideEditViewport();
 const id=initial.metadata?.id??'local-preview';
 const adopt=useCallback((next:PreviewDocument)=>{
  setDocument(next);
  runtimeRef.current?.update({type:STORY_DOCUMENT_MESSAGE,nodes:next.data.nodes,dataflow:next.data.dataflow,refData:next.data.refData,...(next.prepared?{compiledCss:next.prepared.compiledCss,authorCss:next.prepared.authorCss,authorScript:next.prepared.authorScript,theme:next.prepared.theme}:{})});
 },[]);
 const backend=useMemo(()=>createPreviewBackend(file,adopt),[file,adopt]);
 const transport=useMemo(()=>{
  const transport=backend.queryTransport();return {...transport,run:async(...args:Parameters<typeof transport.run>)=>{try{return await transport.run(...args);}finally{setReady(true);}}};
 },[backend]);
 const onController=useCallback((controller:StoryController|null)=>{runtimeRef.current=controller;setNonce(controller?.nonce??null);},[]);
 const finish=useCallback(async()=>{try{await editorFlush.current?.();setEditing(false);}catch(error){setError(error instanceof Error?error.message:String(error));}},[]);
 const annotationsChanged=useCallback((threads:AnnotationWire[])=>setCount(threads.filter(thread=>thread.status==='open').length),[]);
 useEffect(()=>{
  if(capture||!nonce)return;
  const controller=runtimeRef.current!;
  controller.send({type:STORY_SELECTION_ACTIONS_MESSAGE,edit:!editing,annotate:!editing});
  return controller.subscribe(event=>{
   if(!isEditFrameMessage(event,nonce)||event.type!=='mx:selection-action')return;
   if(event.action==='edit')setEditing(true);
   if(event.action==='annotate')setAnnotation(event.selection);
  });
 },[nonce,editing,capture]);
 useEffect(()=>{
  if(capture)return;
  const key=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'){event.preventDefault();void editorFlush.current?.().catch(error=>setError(String(error)));}};
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
 },[capture]);
 useEffect(()=>{
  if(capture||editing)return;
  let alive=true,inflight=false;
  const timer=setInterval(async()=>{
   if(inflight)return;inflight=true;
   try{const response=await fetch('/document?file='+encodeURIComponent(file));const next=await response.json();if(!response.ok)throw Error(next.error);if(alive&&next.revision!==document.revision)adopt(next);}
   catch(error){if(alive)setError(String(error));}finally{inflight=false;}
  },1000);
  return()=>{alive=false;clearInterval(timer);};
 },[file,editing,capture,document.revision,adopt]);
 const runtime=<EditorStoryRuntime data={initial.data} prepared={initial.prepared} authorScript={initial.prepared?.authorScript} transport={transport} onController={onController}/>;
 if(capture)return <div data-afbin-export-ready={ready?'':undefined}>{runtime}</div>;
 const top=editing?(phone?EDIT_BAR_H:APP_BAR_H+EDIT_BAR_H):APP_BAR_H;
 const right=editing?(wide?panelWidth:0):railOpen&&!phone?RIGHT_RAIL_W:0;
 return <ArtifactBackendProvider backend={backend}>
  <TrustedUi overlay layer="navigation">
   <InlineReaderChrome editing={editing} pinned={editing||railOpen} onTitleHost={editing&&!phone?setTitleHost:undefined}
    input={{hideActions:['like','fork','settings','profile'],artifactId:id,title:document.metadata?.title??file,ground:initial.data.colorMode,author:null,ownerBreadcrumb:true,edit:true,editing,viewer:{id:'local-preview',name:'Local preview',image:null},reactions:{like:{count:0,liked:false,href:'#'},follow:null,comment:{count,href:'#'}}}}
    onAction={action=>{if(action==='edit'){if(editing)void finish();else setEditing(true);}if(action==='comment')setRailOpen(open=>!open);}}/>
  </TrustedUi>
  <main aria-label="Artifact viewport" style={{minHeight:'100vh',paddingTop:top,paddingRight:right,paddingBottom:editing&&!wide?'50vh':0}}>{runtime}</main>
  <TrustedUi overlay>
   {error&&<div role="alert" className="fixed bottom-4 left-4 z-50 rounded border border-danger bg-surface p-3 text-sm text-danger">{error}</div>}
   <AnnotationLayer id={id} runtimeRef={runtimeRef} sessionNonce={nonce} railOpen={railOpen} liveAnnotations={null} showViewComments onRailOpenChange={setRailOpen}
    initialSelection={annotation} pickOnOpen={!editing} topOffset={top} onAnnotationsChange={annotationsChanged}
    railHost={editing&&wide?commentsHost:undefined} railSheet={editing&&!wide} panelWidth={editing&&wide?panelWidth:undefined}/>
   {editing&&<ArtifactEditor id={id} onExit={()=>void finish()} flushRef={editorFlush} runtimeRef={runtimeRef} sessionNonce={nonce}
    onComment={setAnnotation} onRightInsetChange={setPanelWidth} commentsOpen={railOpen} onCommentsOpenChange={setRailOpen} onCommentsHost={setCommentsHost} titleHost={titleHost}/>}
  </TrustedUi>
 </ArtifactBackendProvider>;
}
