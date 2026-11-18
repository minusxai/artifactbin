/**
 * Export image expiry (export-expiry-contract.ts) against a REAL S3-compatible server. CI's integration job (its
 * `databases` part, .github/workflows/ci.yml) starts the server and exports TEST_S3_URL, so under CI a missing URL fails
 * this file instead of skipping it, as lib/object-store's store-s3.test.ts does. Elsewhere it skips without one.
 */
import {describe} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {createS3Store,parseS3Url} from '@/lib/object-store';
import {exportExpirySuite} from './export-expiry-contract';

const url=process.env.TEST_S3_URL;
if(!url&&process.env.CI)throw new Error('TEST_S3_URL is not set: CI\'s integration job starts an S3-compatible server and exports it, so these suites must run there, never skip');

useAppHarness();
describe.skipIf(!url)('export image expiry against a real S3-compatible server',()=>{
 exportExpirySuite('s3',async()=>createS3Store(parseS3Url(url!)));
});
