import {expect,it} from 'vitest';
import {liveDatasetIds,marksOfToken,tokenOf} from '../dataset-marks';
it('follows only explicit live dataset bindings and deduplicates shared targets',()=>{
 expect(liveDatasetIds([{kind:'dataset',name:'live',datasetId:'abc123',mode:'live'},{kind:'dataset',name:'again',datasetId:'abc123',mode:'live'},{kind:'dataset',name:'old',datasetId:'def456',mode:'pinned',revision:'1'},{kind:'backend',name:'db',backendId:'ghi789',version:'v1'}])).toEqual(['abc123']);
});
it('preserves opaque dataset catch-up marks without a compilation cache',()=>{
 const marks=new Map([['def456','bbbbbbbbbbbb'],['abc123','aaaaaaaaaaaa']]);expect(tokenOf(marks)).toBe('abc123.aaaaaaaaaaaa~def456.bbbbbbbbbbbb');expect(marksOfToken(tokenOf(marks))).toEqual(new Map([...marks].reverse()));expect(marksOfToken('untrusted')).toEqual(new Map());
});
