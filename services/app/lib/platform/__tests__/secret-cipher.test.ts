import {it,expect} from 'vitest';
import {createSecretCipher,secretCipher} from '..';
it('encrypts with fresh nonces and authenticates the secret\'s whole context',()=>{
 const cipher=createSecretCipher('test-key'),context=['owner','record','TOKEN'],a=cipher.seal('private-value',context),b=cipher.seal('private-value',context);
 expect(a).not.toBe(b);expect(a).not.toContain('private-value');expect(cipher.open(a,context)).toBe('private-value');
 for(const other of [['other','record','TOKEN'],['owner','other','TOKEN'],['owner','record','OTHER'],['owner','record']])expect(()=>cipher.open(a,other)).toThrow();
 expect(()=>createSecretCipher('other-key').open(a,context)).toThrow();
});
it('opens what the same host sealed: one cipher per process, keyed by its own secret',()=>{
 const sealed=secretCipher().seal('v',['a']);
 expect(secretCipher().open(sealed,['a'])).toBe('v');
});
