import {expect,it} from 'vitest';
import {uiChunkName} from '../../vite.config.mts';
const reader='/repo/services/app/solid/pages/Document.tsx';
const entry='/repo/services/app/web/solid-app.tsx';
const local='/repo/services/app/solid/pages/LocalDocument.tsx';
const leaf='/repo/services/app/solid/document/DocumentChrome.tsx';
function grouping(importers,dynamicImporters=[],target=leaf){
 const modules=new Map([[target,{isEntry:false,importers,dynamicImporters}],[reader,{isEntry:false,importers:[],dynamicImporters:[entry]}],[entry,{isEntry:true,importers:[],dynamicImporters:[]}],[local,{isEntry:false,importers:[],dynamicImporters:[entry]}]]);
 return uiChunkName(target,{getModuleInfo:id=>modules.get(id)??null});
}
it('compresses only already-static reader dependencies together',()=>{
 expect(grouping([reader,local])).toBe('reader');
 expect(grouping([reader,entry])).toBeNull();
 expect(grouping([local])).toBeNull();
 expect(grouping([], [reader])).toBeNull();
 expect(grouping([reader], [], '/repo/services/app/lib/optional-author-code.ts')).toBeNull();
});
it('keeps the shared local/hosted presence lifecycle in the existing reader compression boundary',()=>{
 expect(grouping([reader,local], [], '/repo/services/app/solid/document/create-reader-presence.ts')).toBe('reader');
 expect(grouping([reader,entry], [], '/repo/services/app/solid/document/create-reader-presence.ts')).toBeNull();
});

it('compresses the already-eager presence dependency cluster without a new preferences request',()=>{
 for(const leaf of ['preferences','reader-session','model','contract']){
  const target='/repo/services/app/lib/html-presence/'+leaf+'.ts';
  expect(grouping([reader,local], [], target)).toBe('reader');
  expect(grouping([reader,entry], [], target)).toBeNull();
 }
});

it('keeps the entry\'s retry door, live stream and preload helper in one chunk, and the door with the reader when only the reader imports it',()=>{
 const door='/repo/services/app/lib/http/retry-lazily.ts';
 expect(grouping([reader,entry],[],door)).toBe('http');
 expect(grouping([entry],[],'/repo/services/app/lib/http/live-stream.ts')).toBe('http');
 expect(grouping([entry],[],'\0vite/preload-helper.js')).toBe('http');
 expect(grouping([reader,local],[],door)).toBe('reader');
 expect(grouping([local],[],'/repo/services/app/lib/http/live-stream.ts')).toBeNull();
});
