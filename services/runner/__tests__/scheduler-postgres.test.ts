import {it} from 'vitest';
import {proveSchedulerPostgres} from '../src/scheduler-proof';
it.skipIf(!process.env.RUNNER_TEST_DATABASE)('fences concurrent PostgreSQL controllers and preserves uncertain admission across crashes',async()=>{await proveSchedulerPostgres(process.env.RUNNER_TEST_DATABASE!);},30000);
