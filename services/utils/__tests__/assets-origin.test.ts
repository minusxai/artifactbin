import {describe,it,expect} from 'vitest';
import {parseAssetsOrigin,isPublicAssetRequest,publicAssetResponse} from '../src/assets-origin';
describe('public managed asset boundary',()=>{
 const main='https://artifact.example',controls='https://i.artifact.example',asset='https://assets.artifact.example';
 const path='/assets/'+'a'.repeat(64);
 it('accepts a distinct explicit origin',()=>expect(parseAssetsOrigin(main,controls,asset)).toBe(asset));
 it.each(['https://assets.artifact.example/path','https://user:pass@assets.artifact.example','http://assets.artifact.example','https://assets.artifact.example?x=1','https://assets.artifact.example#x','data:text/html,x'])('rejects malformed/insecure origin %s',value=>expect(()=>parseAssetsOrigin(main,controls,value)).toThrow());
 it('accepts explicit loopback development assets',()=>expect(parseAssetsOrigin('http://localhost:5601','http://i.localhost:5601','http://assets.localhost:5601')).toBe('http://assets.localhost:5601'));
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
   expect(isPublicAssetRequest(new Request(asset+path+'?v=abc123def456&w=640'),asset)).toBe(true);
   for(const suffix of ['?v=bad!','?w=-1','?w=1&w=2','?key=secret','/raw','?v=123&v=123'])expect(isPublicAssetRequest(new Request(asset+path+suffix),asset),suffix).toBe(false);
   expect(isPublicAssetRequest(new Request(main+path),asset)).toBe(false);
 });
});
describe('public asset response hardening',()=>{
 it('preserves an existing policy while appending a real sandbox directive',()=>{
  const response=publicAssetResponse(new Response('bytes',{headers:{'content-security-policy':"default-src 'none'",'set-cookie':'secret=yes'}}));
  expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
  expect(response.headers.get('set-cookie')).toBeNull();
 });
});
