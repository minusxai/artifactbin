import {expect,it} from 'vitest';
import {LOCAL_CHROME_CANVAS_SCHEME,LOCAL_CHROME_COLLAPSED_HEIGHT,LocalConnectionError,validLocalSourceEvidence} from '../contracts';
it('admits only exact local source evidence: the kind and one lower-case SHA-256 digest',()=>{
 const evidence={kind:'local-source-evidence',localDigest:'a'.repeat(64)};
 expect(validLocalSourceEvidence(evidence)).toBe(true);
 for(const value of [null,undefined,'evidence',[],{...evidence,extra:true},{...evidence,kind:'grant'},{...evidence,localDigest:'A'.repeat(64)},{...evidence,localDigest:'a'.repeat(63)},{kind:'local-source-evidence'},{...evidence,localDigest:1}])
  expect(validLocalSourceEvidence(value)).toBe(false);
});
it('sizes the collapsed chrome as the platform bar plus the status strip, on a light canvas',()=>{
 expect(LOCAL_CHROME_COLLAPSED_HEIGHT).toBe(44+32);
 expect(LOCAL_CHROME_CANVAS_SCHEME).toBe('light');
});
it('carries the refusal code as both code and message',()=>{
 expect(new LocalConnectionError('stale')).toMatchObject({code:'stale',message:'stale'});
});
