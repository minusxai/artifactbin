import {afterEach,expect,it,vi} from 'vitest';
import {runtimeId as newRequestId} from '@artifactbin/utils/runtime-id';
afterEach(()=>vi.unstubAllGlobals());
it('creates a UUID v4 on ordinary HTTP where randomUUID is unavailable',()=>{
 const random=vi.fn((bytes:Uint8Array)=>{bytes.set(Array.from({length:bytes.length},(_,i)=>i));return bytes;});vi.stubGlobal('crypto',{getRandomValues:random});
 const id=newRequestId();expect(id).toBe('01234567-89ab-4cde-b012-3456789abcde');expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);expect(random).toHaveBeenCalledOnce();
});
