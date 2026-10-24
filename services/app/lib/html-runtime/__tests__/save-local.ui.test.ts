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
