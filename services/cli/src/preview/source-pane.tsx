/** Reuse the hosted editor engine without pulling its authenticated application shell into preview. */
import {useLayoutEffect,useRef} from 'react';
import {createSourceView,type SourceView} from '../../../app/lib/source-editor/codemirror';
export function PreviewSourcePane({value,onChange}:{value:string;onChange:(value:string)=>void}){
 const host=useRef<HTMLDivElement>(null),view=useRef<SourceView|null>(null),latest=useRef({value,onChange});latest.current={value,onChange};
 useLayoutEffect(()=>{
  const editor=createSourceView({parent:host.current!,doc:latest.current.value,readOnly:false,ariaLabel:'Markup source',selection:null,onChange:value=>latest.current.onChange(value)});
  view.current=editor;return()=>{view.current=null;editor.destroy();};
 },[]);
 useLayoutEffect(()=>{view.current?.replace(value);},[value]);
 return <div className="preview-code" ref={host}/>;
}
