/**
 * WHAT THE DEPLOYMENT IMPORTS FROM THIS TREE. The private server repository (minusxai/artifactbin-server)
 * composes the product from these exports (its `@artifactbin/app*` paths resolve to `@/server/host`,
 * `@/lib/platform/config`, `@/lib/platform/db`, `@/lib/accounts/tokens` and `@/lib/artifacts/mutation-invocation`),
 * and its tests and the private evals repository (minusxai/artifactbin-evals) import the rest; an un-export or a move
 * that breaks one breaks production composition, which no check in this repository sees. The packages' own
 * names are pinned beside them (services/<package>/__tests__/downstream-exports.test.ts). Regenerated from
 * artifactbin-server f1741b6 and artifactbin-evals 9c5618b on 2026-11-03. Removing a line here is a change to the
 * deployment contract: do it only together with that repository.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { bearerIdentity, mintAccountToken, request, testIdentity, useAppHarness } from '@/__tests__/harness';
import { GET as getArtifact } from '@/app/api/artifacts/[id]/route';
import { GET as listAnnotations, POST as createAnnotation } from '@/app/api/artifacts/[id]/annotations/route';
import { POST as annotate } from '@/app/api/artifacts/[id]/annotations/[annId]/route';
import { GET as listArtifacts, POST as createArtifact } from '@/app/api/artifacts/route';
import { GET as skillZip } from '@/app/skills/artifactbin.zip/route';
import { createUser, exchangePagesTicket, identityForUser, issuePagesTicket, pagesSessionOf } from '@/lib/accounts';
import { mintToken } from '@/lib/accounts/tokens';
import type { MutationInvocationFactory } from '@/lib/artifacts/mutation-invocation';
import { mintExportKey } from '@/lib/export';
import { exportAssetUrl } from '@/lib/export/assets';
import { objectStore } from '@/lib/object-store';
import { setServices } from '@/lib/platform';
import * as config from '@/lib/platform/config';
import { getDb, resetDb, type Db } from '@/lib/platform/db';
import { createAppHost, type AppHostOptions, type NotificationDelivery } from '@/server/host';

describe('the deployment and the evals compose from', () => {
  it('these functions', () => {
    const functions = {
      bearerIdentity, mintAccountToken, request, testIdentity, useAppHarness, getArtifact, listAnnotations, createAnnotation, annotate,
      listArtifacts, createArtifact, skillZip, createUser, exchangePagesTicket, identityForUser, issuePagesTicket, pagesSessionOf, mintToken,
      mintExportKey, exportAssetUrl, setServices, overrideConfig: config.overrideConfig, resetConfigOverrides: config.resetConfigOverrides, getDb,
      resetDb, createAppHost, objectStore,
    };
    for (const [name, value] of Object.entries(functions)) expect(typeof value, name).toBe('function');
  });

  it('these settings', () => {
    // Present, whatever this process's environment sets them to.
    for (const name of ['AUTH_SERVICE_URL', 'BROWSER_SERVICE_URL', 'DATABASE_URL', 'INTERNAL_SERVICE_SECRET', 'RUNNER_ACTOR_SECRET', 'SQL_SERVICE_URL'])
      expect(name in config, name).toBe(true);
  });

  it('these types', () => {
    expectTypeOf<[MutationInvocationFactory, Db, AppHostOptions, NotificationDelivery]>().not.toBeNever();
  });
});
