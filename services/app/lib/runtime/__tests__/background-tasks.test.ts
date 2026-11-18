import {expect,it} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {getDb} from '@/lib/platform';
import {startAppBackgroundTasks} from '..';
useAppHarness();
it('stop is idempotent: every call returns the one shutdown promise, which resolves',async()=>{
 const db=await getDb();
 const stop=await startAppBackgroundTasks(db);
 const first=stop(),second=stop();
 expect(second).toBe(first);
 await expect(first).resolves.toBeUndefined();
 expect(stop()).toBe(first);
});
