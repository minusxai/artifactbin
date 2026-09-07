import {describe,it,expect} from 'vitest';
import {isPublicAssetRequest} from '../src/assets-origin';
describe('anonymous-readable reference asset path',()=>{
 const origin='https://assets.example.test';
 it('admits only exact GET and HEAD reference byte paths',()=>{
  expect(isPublicAssetRequest(new Request(origin+'/assets/ref/Abc123'),origin)).toBe(true);
  expect(isPublicAssetRequest(new Request(origin+'/assets/ref/Abc123',{method:'HEAD'}),origin)).toBe(true);
  expect(isPublicAssetRequest(new Request(origin+'/assets/ref/Abc123',{method:'POST'}),origin)).toBe(false);
  expect(isPublicAssetRequest(new Request(origin+'/assets/ref/Abc123?key=secret'),origin)).toBe(false);
 });
});
