import {expect,it} from 'vitest';
import {mayPublishBackendChange,requiresFreshBackendIdentity} from '../authority';
it('only the personal owner can approve new or existing credential-bearing code',()=>{
 for(const declaresSecrets of [false,true])for(const historicalSecrets of [false,true]){
 expect(mayPublishBackendChange({personalOwner:true,declaresSecrets,historicalSecrets})).toBe(true);
 expect(mayPublishBackendChange({personalOwner:false,declaresSecrets,historicalSecrets})).toBe(!declaresSecrets&&!historicalSecrets);
 }
});
it('changes backend credential identity when immutable ownership changes',()=>{
 expect(requiresFreshBackendIdentity({previousOwnerId:'old',nextOwnerId:'new'})).toBe(true);
 expect(requiresFreshBackendIdentity({previousOwnerId:'same',nextOwnerId:'same'})).toBe(false);
});
