/** Export image expiry (export-expiry-contract.ts) on the app's filesystem store; export-expiry-s3.test.ts runs it on S3. */
import {useAppHarness} from '@/__tests__/harness';
import {objectStore} from '@/lib/object-store';
import {exportExpirySuite} from './export-expiry-contract';

useAppHarness();
exportExpirySuite('filesystem',async()=>objectStore());
