import {it,expect} from 'vitest';
import {redactRunSecrets} from '../secret-redaction';
it('redacts nested output, errors, logs and keys without treating empty credentials as matches',()=>{
 const secrets=new Set(['credential','']);
 expect(redactRunSecrets({result:['credential',{credential:'error: credential'}],log:'credential'},secrets)).toEqual({result:['[redacted]',{'[redacted]':'error: [redacted]'}],log:'[redacted]'});
 expect(redactRunSecrets('unrelated',secrets)).toBe('unrelated');expect(redactRunSecrets('credential',new Set())).toBe('credential');
});
it('matches literal punctuation and short values without recursively corrupting replacements',()=>{
 expect(redactRunSecrets('a.+ a',new Set(['a','a.+']))).toBe('[redacted] [redacted]');
});
