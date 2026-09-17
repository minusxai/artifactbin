import {expect,it} from 'vitest';
import {collectRefUses,validateRefs} from '../refs';
import {resolveRefProps,type RefDataMap} from '../ref-data';
it('collects and resolves attachment links and native media through the same ref syntax',async()=>{
 const source='<a href="ref:abc123">Download</a><video src="ref:def456" poster="ref:ghi789" /><audio src="ref:jkl012" />';
 expect(collectRefUses(source)?.map(use=>use.id).sort()).toEqual(['abc123','def456','ghi789','jkl012']);
 const checked=await validateRefs(source,async id=>({id,format:id==='ghi789'?'image':'file'}));expect(checked.ok).toBe(true);
 const data={abc123:{kind:'file',url:'/a/abc123/raw?v=2'},def456:{kind:'file',url:'/a/def456/raw?v=1'}} as unknown as RefDataMap;
 expect(resolveRefProps({isComponent:false,tag:'a'},{href:'ref:abc123'},data)).toEqual({href:'/a/abc123/raw?v=2'});
 expect(resolveRefProps({isComponent:false,tag:'video'},{src:'ref:def456'},data)).toEqual({src:'/a/def456/raw?v=1'});
});
