import {createEffect,createMemo,createSignal,on,onCleanup,type Accessor} from 'solid-js';
import type {AnnotationWire} from '@/lib/annotations';
import type {LinkedDocument,LocalConnectionState} from '@/lib/local-connection';
import type {DocumentRuntimeRef} from '@/lib/story-runtime/document-endpoint';
import {createLocalReadBackend} from '@/lib/local-connection/read-backend';
import {createLiveArtifact} from '../editor/create-live-artifact';
import {createReaderPresence} from './create-reader-presence';
/** The same live reader as hosted pages, under anonymous ACLs and the current local connection lifetime. */
export function createLocalReader(options:{identity:Accessor<LinkedDocument|undefined>;state:Accessor<LocalConnectionState>;nonce:Accessor<string|null>;runtimeRef:DocumentRuntimeRef;sourceChanged():void}){
 const backend=createMemo(()=>createLocalReadBackend(options.identity()?.artifactId??'local'));
 const enabled=()=>options.state()==='connected'&&!!options.identity()&&!!options.nonce();
 const [annotations,setAnnotations]=createSignal<AnnotationWire[]|null>(null);
 const presence=createReaderPresence({get id(){return options.identity()?.artifactId??'local';},get revision(){return options.identity()?.baseRevision??'0';},enabled,nonce:options.nonce,runtimeRef:options.runtimeRef,get backend(){return backend();}});
 createEffect(on([options.identity,options.nonce,options.state],()=>{
  setAnnotations(null);
  if(!enabled())return;
  let active=true;onCleanup(()=>{active=false;});
  createLiveArtifact({get backend(){return backend();},get id(){return options.identity()?.artifactId??'local';},initialEditId:'',get initialVersion(){return Number(options.identity()?.baseRevision??0);},get enabled(){return enabled()&&typeof EventSource==='function';},
  onAnnotations(value){if(active&&enabled())setAnnotations(value);},onPresence(value){if(active&&enabled())presence.receive(value);},
  onData(event){if(active&&enabled())options.runtimeRef.current?.invalidate?.(event.datasets);},
  onPublication(){if(active&&enabled())options.sourceChanged();},
  });
 }));
 return {backend,annotations,presence};
}
