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
