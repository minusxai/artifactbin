import {describe,it,expect} from 'vitest';
import {parseAssetsOrigin,isPublicAssetRequest} from '../src/assets-origin';
describe('public managed asset boundary',()=>{
 const main='https://artifact.example',controls='https://i.artifact.example',asset='https://assets.artifact.example';
 const path='/assets/'+'a'.repeat(64);
 it('accepts a distinct explicit origin',()=>expect(parseAssetsOrigin(main,controls,asset)).toBe(asset));
 it('refuses account and artifact hosts even on another port',()=>{
   expect(()=>parseAssetsOrigin(main,controls,controls)).toThrow();
   expect(()=>parseAssetsOrigin(main,controls,main+':444')).toThrow();
 });
 it('allows only cached byte reads on the asset host',()=>{
   expect(isPublicAssetRequest(new Request(asset+path),asset)).toBe(true);
   expect(isPublicAssetRequest(new Request(asset+path,{method:'HEAD'}),asset)).toBe(true);
   expect(isPublicAssetRequest(new Request(asset+path,{method:'POST'}),asset)).toBe(false);
   expect(isPublicAssetRequest(new Request(asset+'/api/my/session'),asset)).toBe(false);
   expect(isPublicAssetRequest(new Request(asset+'/a/Abc123/resolve?ref=ref:Def456'),asset)).toBe(false);
   expect(isPublicAssetRequest(new Request(asset+path+'?url=https://evil.example'),asset)).toBe(false);
 });
});
