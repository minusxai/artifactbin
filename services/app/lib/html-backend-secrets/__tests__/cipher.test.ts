import {it,expect} from 'vitest';
import {createBackendSecretCipher} from '../cipher';
it('encrypts with fresh nonces and authenticates owner, backend and binding name',()=>{
 const cipher=createBackendSecretCipher('test-key'),scope={ownerId:'owner',backendId:'backend'},a=cipher.seal('private-value',scope,'TOKEN'),b=cipher.seal('private-value',scope,'TOKEN');
 expect(a).not.toBe(b);expect(a).not.toContain('private-value');expect(cipher.open(a,scope,'TOKEN')).toBe('private-value');
 for(const s of [{...scope,ownerId:'other'},{...scope,backendId:'other'}])expect(()=>cipher.open(a,s,'TOKEN')).toThrow();
 expect(()=>cipher.open(a,scope,'OTHER')).toThrow();expect(()=>createBackendSecretCipher('other-key').open(a,scope,'TOKEN')).toThrow();
});
