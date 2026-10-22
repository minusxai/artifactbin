import test from 'node:test';import assert from 'node:assert/strict';import{encodeAscii91,decodeAscii91}from'../src/migration/conversion/compiled/ascii91.ts';
test('dense transport round trips all byte values and uneven bit tails without HTML delimiters',()=>{
 const bytes=Uint8Array.from({length:4097},(_,i)=>(i*157)%256);
 for(const length of [0,1,2,3,7,13,255,256,4097]){const source=bytes.slice(0,length),encoded=encodeAscii91(source);assert.deepEqual(decodeAscii91(encoded),source);assert.doesNotMatch(encoded,/[<>\\]/);}
 for(const text of ['<','>','\\',' ','é'])assert.throws(()=>decodeAscii91(text));
});
