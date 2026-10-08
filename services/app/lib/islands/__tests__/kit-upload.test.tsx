/* @jsxImportSource solid-js */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createDataflowStore, type QueryTransport } from '@/lib/story-runtime/store';
import { bindPage } from '@/lib/story-runtime/page-bindings';
import { createIslandRuntime } from '../rt';
import { IslandProvider } from '../context';
import { FileUpload } from '../kit/upload';
import { PreviewFileUpload } from '../kit/static/preview-controls';
import type { CompiledDataflow } from '@/lib/story/data/compiled-dataflow';

const flow: CompiledDataflow = { imports: [{ name: 'attachments', ref: 'Attach0001', tables: [] }], values: [
  {name:'refs',kind:'scalar',type:'string',default:'[]'}, {name:'uploading',kind:'scalar',type:'boolean',default:false},
], queries:[],mutations:[] };
const stops: Array<()=>void> = [];
afterEach(()=>{ for(const stop of stops.splice(0))stop(); document.body.innerHTML=''; });
function setup(fetchFn: (input:string,init?:RequestInit)=>Promise<Response>, signedIn=true) {
  document.body.setAttribute('data-mx-live-id','abc123'); document.body.setAttribute('data-mx-live-edit','edit1234');
  const transport: QueryTransport={run:async()=>({tables:{},errors:{}}),page:async()=>({rows:[],columns:[]}),image:['/a/abc123/query',fetchFn,'include']};
  const runtime=createIslandRuntime({dataflow:{flow}}, input=>createDataflowStore(input,{transport}));
  runtime.context.viewer=()=>signedIn?{hinted:true}:null;
  const host=document.createElement('div'); document.body.append(host);
  const dispose=render(()=><IslandProvider value={runtime.context}><FileUpload dataset="attachments" value="$refs" busy="$uploading" multiple label="Screenshots" accept="image/png" maxFiles={3}/></IslandProvider>,host);
  stops.push(()=>{dispose();bindPage(runtime.store!).dispose();runtime.dispose();host.remove();});
  const choose=(files:File[])=>{const field=host.querySelector('input')!;Object.defineProperty(field,'files',{configurable:true,value:files});field.dispatchEvent(new Event('change',{bubbles:true}));};
  return {host,choose,store:runtime.store!,dispose};
}
const receipt=(ref:string,name='screen.png')=>Response.json({ref,url:'/ignored',name,contentType:'image/png',size:3});
describe('FileUpload over the bound page store',()=>{
  it('renders a static preview without a store or upload request',()=>{
    const host=document.createElement('div');const dispose=render(()=><PreviewFileUpload p={{dataset:'attachments',value:'$refs',multiple:true,label:'Screenshots'}}/>,host);stops.push(dispose);
    expect(host.textContent).toContain('Choose files');expect(host.querySelector('button')!.disabled).toBe(true);expect(host.querySelector('input')).toBeNull();
  });
  it('stores durable refs, previews through the dataset door, and removes references without deleting files',async()=>{
    const upload=vi.fn(async()=>receipt('dfile:abc234def456'));
    const s=setup(upload);s.choose([new File(['png'],'screen.png',{type:'image/png'})]);
    await vi.waitFor(()=>expect(s.store.getValue('refs')).toBe('["dfile:abc234def456"]'));
    expect(s.host.querySelector('img')?.src).toContain('/datasets/Attach0001/files/abc234def456');
    expect(s.store.getValue('uploading')).toBe(false);
    expect(s.host.textContent).toContain('3 bytes');
    s.host.querySelector<HTMLButtonElement>('[aria-label="Remove screen.png"]')!.click();
    expect(s.store.getValue('refs')).toBe('[]');expect(upload).toHaveBeenCalledTimes(1);
  });
  it('keeps earlier successes and retries the same File with the same idempotency key',async()=>{
    const upload=vi.fn().mockResolvedValueOnce(receipt('dfile:abc234def456','first.png')).mockResolvedValueOnce(Response.json({error:'Try again'},{status:503})).mockResolvedValueOnce(receipt('dfile:def234abc456','second.png'));
    const s=setup(upload);const first=new File(['a'],'first.png',{type:'image/png'}),second=new File(['b'],'second.png',{type:'image/png'});s.choose([first,second]);
    await vi.waitFor(()=>expect(s.host.querySelector('[role="alert"]')?.textContent).toContain('Try again'));
    expect(s.store.getValue('refs')).toBe('["dfile:abc234def456"]');
    s.host.querySelector<HTMLButtonElement>('[aria-label="Retry second.png"]')!.click();
    await vi.waitFor(()=>expect(s.store.getValue('refs')).toBe('["dfile:abc234def456","dfile:def234abc456"]'));
    const failed=upload.mock.calls[1]![1] as RequestInit,retried=upload.mock.calls[2]![1] as RequestInit;
    expect(retried.body).toBe(second);expect(new Headers(retried.headers).get('Idempotency-Key')).toBe(new Headers(failed.headers).get('Idempotency-Key'));
  });
  it('blocks signed-out uploads and rejects unacceptable files before a request',async()=>{
    const fetch=vi.fn(async()=>receipt('dfile:abc234def456'));const guest=setup(fetch,false);
    expect(guest.host.querySelector('input')!.disabled).toBe(true);guest.choose([new File(['a'],'x.png',{type:'image/png'})]);expect(fetch).not.toHaveBeenCalled();
    const signed=setup(fetch);signed.choose([new File(['a'],'notes.txt',{type:'text/plain'})]);
    expect(signed.host.querySelector('[role="alert"]')?.textContent).toContain('accepted');expect(fetch).not.toHaveBeenCalled();
  });
  it('limits selections before sending bytes and keeps busy false',()=>{
    const fetch=vi.fn(async()=>receipt('dfile:abc234def456'));const s=setup(fetch);
    s.choose(Array.from({length:4},(_,i)=>new File(['a'],`${i}.png`,{type:'image/png'})));
    expect(s.host.querySelector('[role="alert"]')?.textContent).toContain('at most 3');
    expect(fetch).not.toHaveBeenCalled();expect(s.store.getValue('uploading')).toBe(false);
  });
  it('does not update a disposed control when an upload lands',async()=>{
    let resolve!:(v:Response)=>void;const s=setup(()=>new Promise(r=>{resolve=r;}));s.choose([new File(['a'],'x.png',{type:'image/png'})]);s.dispose();resolve(receipt('dfile:abc234def456'));
    await new Promise(r=>setTimeout(r,0));expect(s.store.getValue('refs')).toBe('[]');expect(s.store.getValue('uploading')).toBe(false);
  });
  it('ignores late upload results after an external value reset',async()=>{
    let resolve!:(v:Response)=>void;const s=setup(()=>new Promise(r=>{resolve=r;}));s.choose([new File(['a'],'x.png',{type:'image/png'})]);
    expect(s.store.getValue('uploading')).toBe(true);expect(s.host.querySelector('progress')?.hasAttribute('value')).toBe(false);
    s.store.setValue('refs','["dfile:aaa234bbb456"]');resolve(receipt('dfile:abc234def456'));
    await vi.waitFor(()=>expect(s.store.getValue('uploading')).toBe(false));expect(s.store.getValue('refs')).toBe('["dfile:aaa234bbb456"]');
  });
});
