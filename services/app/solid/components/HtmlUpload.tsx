/* @jsxImportSource solid-js */
import {createSignal,onCleanup,Show,type JSX} from 'solid-js';
import type {ArtifactDestination} from '@artifactbin/contracts';
import {checkHtmlUpload,type HtmlUploadSelection} from '../lib/html-upload';
import {apiFetch} from '../lib/api';
import {openDocument} from '../lib/document-navigation';
import {pageDataChanged} from '../lib/page-data-events';
import {Dialog} from '../ui/Dialog';
import {Button} from '../ui/Button';
import {DropZone} from '../ui/DropZone';
import {StatusMessage} from '../ui/StatusMessage';

interface HtmlUploadProps {onClose:()=>void;parentId?:string|null;destination?:ArtifactDestination}
const readHtml=(file:File)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('read failed'));reader.readAsText(file);});
/** HTML is published as a page, never uploaded as an asset or executed in this dialog. */
export default function HtmlUpload(props:HtmlUploadProps):JSX.Element {
 const [selected,setSelected]=createSignal<HtmlUploadSelection|null>(null),[busy,setBusy]=createSignal(false),[reading,setReading]=createSignal(false),[error,setError]=createSignal('');
 let sequence=0;onCleanup(()=>{sequence++;});
 const pick=async(file:File)=>{
  const current=++sequence;setSelected(null);setError('');setReading(false);
  const checked=checkHtmlUpload(file);if(!checked.ok){setError(checked.error);return;}
  setReading(true);
  try{const html=await readHtml(file);if(current!==sequence)return;if(!html.trim()){setError('The HTML file is empty.');return;}setSelected({filename:file.name,html});}
  catch{if(current===sequence)setError('Could not read that file. Choose it again.');}
  finally{if(current===sequence)setReading(false);}
 };
 const upload=async()=>{
  const file=selected();if(!file||busy()||reading())return;setBusy(true);setError('');
  try{
   const response=await apiFetch('/api/my/artifacts','POST',{html:file.html,visibility:'private',parent_id:props.parentId??null,...(props.destination?{destination:props.destination}:{})});
   const data=await response.json().catch(()=>null) as {id?:string;details?:string[]}|null;
   if(!response.ok||!data?.id){setError(response.status===401?'Sign in again before uploading this HTML file.':response.status===413?'The HTML file exceeds the 2 MB limit.':data?.details?.[0]??'Could not publish that HTML file. Check the file and try again.');return;}
   pageDataChanged();openDocument(`/a/${encodeURIComponent(data.id)}`);
  }catch{setError('Upload failed. Check your connection and your workspace before trying again.');}
  finally{setBusy(false);}
 };
 return <Dialog title="Upload HTML" busy={busy()} onClose={props.onClose} footer={<><Button variant="secondary" disabled={busy()} onClick={props.onClose}>Cancel</Button><Button disabled={!selected()||busy()||reading()} onClick={()=>void upload()}>{busy()?'Uploading…':'Upload HTML'}</Button></>}>
  <div class="grid gap-4">
   <p class="text-sm text-muted">Publish an HTML file as a private page in this workspace.</p>
   <DropZone label="Choose HTML file" title="Choose or drop an HTML file" hint=".html or .htm · up to 2 MB" accept=".html,.htm,text/html" size="sm" disabled={busy()} onFiles={([file])=>{if(file)void pick(file);}}/>
   <Show when={selected()}>{file=><p class="break-words text-sm text-fg">{file().filename}</p>}</Show>
   <Show when={reading()}><StatusMessage kind="loading">Reading HTML…</StatusMessage></Show>
   <Show when={error()}><StatusMessage kind="error">{error()}</StatusMessage></Show>
  </div>
 </Dialog>;
}
