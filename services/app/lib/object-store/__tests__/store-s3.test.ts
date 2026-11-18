/**
 * The S3 backend against a REAL S3-compatible server, held to the same contracts as the local backend
 * (store-contract.ts). CI's integration job (its `databases` part, .github/workflows/ci.yml) starts one, makes its
 * bucket and exports TEST_S3_URL (`http://KEY:SECRET@host:port/bucket/prefix`), so under CI a missing URL fails this
 * file instead of skipping it, as a missing database image does (services/test-support/src/docker.ts). Elsewhere it
 * skips without one.
 *
 * `raises ObjectUnavailable for a missing key` needs the IAM user to hold s3:ListBucket on a real S3: without it S3
 * answers an absent key with 403 AccessDenied instead of 404 NoSuchKey, which is what turns a read of an unknown key
 * into a 500. A failure there is a defect in the deployment rather than in the assertion — the contract stays as
 * written and the fix is the ListBucket grant.
 */
import { describe, expect, it } from 'vitest';
import { createS3Store, parseS3Url } from '../index';
import { contractSuite, streamSuite } from './store-contract';

const url = process.env.TEST_S3_URL;
if (!url && process.env.CI) throw new Error('TEST_S3_URL is not set: CI\'s integration job starts an S3-compatible server and exports it, so these suites must run there, never skip');

describe.skipIf(!url)('the S3 backend against a real server', () => {
  contractSuite('s3', async () => createS3Store(parseS3Url(url!)));

  describe('getStream', () => {
    streamSuite('s3', async () => createS3Store(parseS3Url(url!)));
  });

  describe('the prefix is actually applied to stored keys', () => {
    it('writes under <prefix>/<key>, not at the bucket root', async () => {
      const cfg = parseS3Url(url!);
      expect(cfg.prefix).toBeTruthy(); // the fixture must exercise a prefix
      const store = createS3Store(cfg);
      const key = `dataset/prefix-probe-${Date.now()}`;
      await store.put(key, 'x');

      const { S3Client, HeadObjectCommand } = await import('@aws-sdk/client-s3');
      const raw = new S3Client({
        region: cfg.region, endpoint: cfg.endpoint, forcePathStyle: cfg.forcePathStyle,
        credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      });
      // Present at the prefixed path…
      await expect(raw.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: `${cfg.prefix}/${key}` }))).resolves.toBeTruthy();
      // …and absent at the unprefixed one, which is where a dropped prefix would
      // land it — on top of another environment's objects.
      await expect(raw.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }))).rejects.toBeTruthy();
      await store.delete(key);
    });
  });
});
