import {expect,it,vi} from 'vitest';
import {saveLocalDocument} from '../save-local';
import {readPortableDocument,portableScript} from '../portable';
it('saves actual edited bytes with only the explicitly supplied current private snapshot',async()=>{
 const source='<html><body><h1 data-af-id="title">Before</h1></body></html>';
 const selected=portableScript({version:1,source})+source.replace('>Before</h1>','>Edited</h1>');
 document.head.innerHTML='<script type="application/json" data-af="runtime">{"pageId":"p","revision":"1","backends":[],"localPreview":{"endpoint":"/secret-session"}}</script><script type="application/json" data-af="apollo">"module"</script><script type="application/json" data-af="reader">"reader"</script><script data-af="core">boot()</script>';
 let blob:Blob|undefined;
 vi.spyOn(URL,'createObjectURL').mockImplementation(value=>{blob=value as Blob;return 'blob:download';});
 vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
 await saveLocalDocument({win:window,sourceBytes:selected,privateState:{filter:'current',draft:'private'}});
 const html=await blob!.text();
 expect(readPortableDocument(html).source).toContain('>Edited</h1>');
 expect(readPortableDocument(html).privateState).toEqual({filter:'current',draft:'private'});
 expect(html).not.toContain('/secret-session');
});

it('acquires actual edited selection and reports canonical bytes, while cancellation downloads nothing',async()=>{
 const baseline='<html><body>Before</body></html>',edited=baseline.replace('Before','Edited');
 const selected=portableScript({version:1,source:baseline})+edited;
 document.head.innerHTML='<script data-af="runtime" type="application/json">{}</script><script data-af="apollo" type="application/json">"module"</script><script data-af="reader" type="application/json">"reader"</script><script data-af="core">boot()</script>';
 const onSource=vi.fn();let blob:Blob|undefined;
 const download=vi.spyOn(URL,'createObjectURL').mockImplementation(value=>{blob=value as Blob;return 'blob:selected';});
 vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
 const picker=vi.spyOn(HTMLInputElement.prototype,'click').mockImplementation(function(this:HTMLInputElement){Object.defineProperty(this,'files',{value:[new File([selected],'edited.html')],configurable:true});this.dispatchEvent(new Event('change'));});
 expect(await saveLocalDocument({win:window,onSource})).toBe(true);
 expect(onSource).toHaveBeenCalledWith(edited);expect(readPortableDocument(await blob!.text()).source).toBe(edited);
 download.mockClear();onSource.mockClear();picker.mockImplementation(function(this:HTMLInputElement){this.dispatchEvent(new Event('cancel'));});
 expect(await saveLocalDocument({win:window,onSource})).toBe(false);expect(onSource).not.toHaveBeenCalled();expect(download).not.toHaveBeenCalled();vi.restoreAllMocks();
});

it('saves confined preview rendering with canonical source, a valid digest and only supplied private state',async()=>{
 const {recoverPortableSource}=await import('../portable-source');
 const source='<html><head><script type="module" src="./component.js"></script></head><body>Canonical</body></html>';
 const rendered=source.replace('./component.js','data:text/javascript;base64,'+Buffer.from('export const value=42;').toString('base64'));
 document.documentElement.setAttribute('data-af-private-preview','true');window.history.replaceState({},'', '/index.html');document.head.innerHTML='<script data-af="runtime" type="application/json">{"pageId":"local","localPreview":{"endpoint":"/private"}}</script>';
 const assets={apollo:'apollo',reader:'reader',core:'boot()'};const fetcher=vi.fn(async(url:string)=>new Response(JSON.stringify(url.startsWith('/__af_preview/export-source?')?{html:source,renderedHtml:rendered}:assets),{status:200}));
 vi.stubGlobal('fetch',fetcher);let blob:Blob|undefined;const download=vi.spyOn(URL,'createObjectURL').mockImplementation(value=>{blob=value as Blob;return 'blob:preview';});vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
 const onSource=vi.fn();expect(await saveLocalDocument({win:window,privateState:{draft:'mine'},onSource})).toBe(true);
 const saved=await blob!.text();expect(readPortableDocument(saved).source).toBe(source);expect(readPortableDocument(saved).privateState).toEqual({draft:'mine'});expect(recoverPortableSource(saved)).toBe(source);expect(saved).toContain('data:text/javascript;base64,');expect(saved).not.toContain('/private');expect(onSource).toHaveBeenCalledWith(source);
 download.mockClear();fetcher.mockImplementation(async()=>new Response('{"error":"missing dependency"}',{status:422}));await expect(saveLocalDocument({win:window})).rejects.toThrow(/missing dependency/);expect(download).not.toHaveBeenCalled();document.documentElement.removeAttribute('data-af-private-preview');vi.unstubAllGlobals();vi.restoreAllMocks();
});
