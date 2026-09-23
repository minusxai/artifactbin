import {expect,it} from 'vitest';
import {useAppHarness} from './harness';
import {GET} from '@/app/people/[id]/route';
import {createUser} from '@/lib/users';
import {getDb} from '@/lib/db';
useAppHarness();
it('keeps stable profile links on the public origin behind a reverse proxy',async()=>{
 const user=await createUser({email:'mxmx_test_profile_redirect@example.com'});
 await (await getDb()).query('UPDATE users SET username=$2 WHERE id=$1',[user.id,'profile_reader']);
 const response=await GET(new Request(`http://artifactbin-app:3000/people/${user.id}`),{params:Promise.resolve({id:user.id})});
 expect(response.status).toBe(302);
 expect(response.headers.get('location')).toBe('/@profile_reader');
});
it('does not redirect unknown accounts',async()=>{
 const response=await GET(new Request('http://artifactbin-app:3000/people/missing'),{params:Promise.resolve({id:'missing'})});
 expect(response.status).toBe(404);
});
