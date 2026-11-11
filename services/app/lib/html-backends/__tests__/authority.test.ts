import {expect,it} from 'vitest';
import {credentialNames,mayPublishBackendChange,requiresFreshBackendIdentity} from '../authority';
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
it('a viewer binding is not a credential; every other declared name is',()=>{
 expect(credentialNames({secretBindings:['DB','FIN','KEY'],secretHosts:{DB:'postgres',FIN:'viewer',KEY:'api.example.com'}})).toEqual(['DB','KEY']);
 expect(credentialNames({secretBindings:['FIN'],secretHosts:{FIN:'viewer'}})).toEqual([]);
 // A name with no recorded kind is counted: unknown is a credential.
 expect(credentialNames({secretBindings:['OLD']})).toEqual(['OLD']);
 expect(credentialNames({})).toEqual([]);
});
