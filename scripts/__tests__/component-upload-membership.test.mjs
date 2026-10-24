import {it,expect,vi} from 'vitest';
import {joinUploadFixtures} from '../lib/component-upload-membership.mjs';
it('uses the normal join action and refuses denied or unaccepted participation before uploads',async()=>{
 const options={origin:'http://localhost:3030',entries:[{id:'Page123'}],token:'unit-token'},send=vi.fn(async()=>new Response(JSON.stringify({self:{status:'accepted'}}),{status:200}));
 await expect(joinUploadFixtures({...options,send})).resolves.toEqual([{id:'Page123',status:'accepted'}]);
 expect(send).toHaveBeenCalledWith('http://localhost:3030/api/artifacts/Page123/members',expect.objectContaining({method:'POST',body:'{"action":"join"}'}));
 await expect(joinUploadFixtures({...options,send:async()=>new Response('{}',{status:403})})).rejects.toThrow('Actual owner membership');
 await expect(joinUploadFixtures({...options,send:async()=>new Response('{"self":{"status":"pending"}}',{status:200})})).rejects.toThrow('accepted participation');
});
it('verifies automatic owner membership with a read and never silently joins a missing owner',async()=>{
 const {uploadFixtureParticipation}=await import('../lib/component-upload-membership.mjs');
 const options={origin:'http://localhost:3030',entries:[{id:'Page123'}],token:'unit-token'},send=vi.fn(async()=>new Response('{"self":{"status":"accepted"}}',{status:200}));
 await expect(uploadFixtureParticipation({...options,send})).resolves.toEqual([{id:'Page123',status:'accepted'}]);expect(send.mock.calls[0][1].method).toBe('GET');
 await expect(uploadFixtureParticipation({...options,send:async()=>new Response('{"self":null}',{status:200})})).rejects.toThrow('accepted participation');
});
