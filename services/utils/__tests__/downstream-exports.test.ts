/**
 * WHAT THE DEPLOYMENT IMPORTS FROM @artifactbin/utils. The private server repository
 * (minusxai/artifactbin-server) composes the product from these names; removing one breaks that build, which no
 * other check here sees. Named imports, so knip's entry-export check (knip.config.js `includeEntryExports`)
 * counts them as used and refuses every other unused export. Regenerated from artifactbin-server f1741b6 and
 * artifactbin-evals 9c5618b on 2026-11-03: change a line only together with that repository.
 */
import { expect, expectTypeOf, it } from 'vitest';
import {
  SERVING_POOL, actorOf, actorReceiver, assemble, buildAssetRequest, buildAssetResponse, createEnv, envelope,
  eventsClient, fakeEvents, hashToken, httpClient, humanSessionClient, inProcess, isPublicAssetRequest, log, noopEvents,
  overHttp, parseAssetsOrigin, parseDatasetPolicy, publicAssetResponse, serve, serviceSecretForServer, signActor,
  verifyActor, withPoolErrors,
  type EventObject, type EventSubject, type FakeEvents,
} from '@artifactbin/utils';

it('exports the values the deployment imports', () => {
  const values = { SERVING_POOL, actorOf, actorReceiver, assemble, buildAssetRequest, buildAssetResponse, createEnv, envelope, eventsClient, fakeEvents, hashToken, httpClient, humanSessionClient, inProcess, isPublicAssetRequest, log, noopEvents, overHttp, parseAssetsOrigin, parseDatasetPolicy, publicAssetResponse, serve, serviceSecretForServer, signActor, verifyActor, withPoolErrors };
  for (const [name, value] of Object.entries(values)) expect(value, name).toBeDefined();
});

it('exports the types the deployment imports', () => {
  expectTypeOf<[EventObject, EventSubject, FakeEvents]>().not.toBeNever();
});
