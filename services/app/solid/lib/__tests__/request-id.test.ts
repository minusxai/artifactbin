import {afterEach,expect,it,vi} from 'vitest';
import {newRequestId} from '../request-id';
afterEach(()=>vi.unstubAllGlobals());
it('creates a UUID v4 on ordinary HTTP where randomUUID is unavailable',()=>{
 const random=vi.fn((bytes:Uint8Array)=>{bytes.set(Array.from({length:16},(_,i)=>i));return bytes;});vi.stubGlobal('crypto',{getRandomValues:random});
 expect(newRequestId()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');expect(random).toHaveBeenCalledOnce();
});
it('uses the native UUID API when available and refuses insecure randomness',()=>{
 vi.stubGlobal('crypto',{randomUUID:()=> 'native-id'});expect(newRequestId()).toBe('native-id');vi.stubGlobal('crypto',{});expect(()=>newRequestId()).toThrow('Secure random values');
});
