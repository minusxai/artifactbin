/** A quota override must not outlive its test file: the api project shares one module graph per worker, so the file-end
 * reset (`resetConfigOverrides`, run by the shared setup) clears every override registered with it. Main went red on
 * 2026-11-17 when asset-byte-quota.test.ts left a 1 MB byte cap set for the next file on its worker. */
import { expect, it } from 'vitest';
import { ARTIFACT_QUOTA_PER_TOKEN, ASSETS_MAX_BYTES_PER_TOKEN } from '@/lib/platform';
import { resetConfigOverrides } from '@/lib/platform/config';
import { artifactQuotaLimit, assetByteQuotaLimit, setArtifactQuotaForTests, setAssetByteQuotaForTests } from '@/lib/artifacts/testing';

it('the file-end reset clears the artifact count and asset byte quota overrides', () => {
  setArtifactQuotaForTests(1);
  setAssetByteQuotaForTests(1_000_000);
  expect([artifactQuotaLimit(), assetByteQuotaLimit()]).toEqual([1, 1_000_000]);
  resetConfigOverrides();
  expect([artifactQuotaLimit(), assetByteQuotaLimit()]).toEqual([ARTIFACT_QUOTA_PER_TOKEN, ASSETS_MAX_BYTES_PER_TOKEN]);
});
