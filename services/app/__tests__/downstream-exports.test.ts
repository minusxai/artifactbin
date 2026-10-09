/**
 * WHAT THE DEPLOYMENT IMPORTS FROM THIS TREE. The private server repository (minusxai/artifactbin-server)
 * composes the product from these exports; an un-export or a move that breaks one breaks production
 * composition, which no check in this repository sees. Regenerated from that repository's imports on
 * 2026-10-10. Values are asserted through a real import; types are asserted by reading the module's source
 * (following one level of `export * from`), because the type names include generics of varying arity.
 * Removing a line here is a change to the deployment contract: do it only together with the server repository.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = resolve(__dirname, '..');
const ROOT = resolve(APP, '../..');
function sourceOf(module: string): string {
  const base = module === '@artifactbin/contracts' ? resolve(ROOT, 'services/contracts/src/index')
    : module.startsWith('@artifactbin/utils') ? resolve(ROOT, 'services/utils/src', module.split('/')[2] ?? 'index')
    : resolve(APP, module.slice(2));
  const file = ['.ts', '.tsx', '/index.ts'].map((e) => base + e).find((f) => existsSync(f));
  if (!file) throw new Error('module not found: ' + module);
  const own = readFileSync(file, 'utf8');
  const stars = [...own.matchAll(/^export \* from '(\.[^']+)';/gm)].map((m) => {
    const target = resolve(dirname(file), m[1]);
    const f = ['.ts', '.tsx', '/index.ts', ''].map((e) => target + e).find((x) => existsSync(x) && !x.endsWith('/'));
    return f ? readFileSync(f, 'utf8') : '';
  });
  return [own, ...stars].join('\n');
}
const exportsType = (source: string, name: string) =>
  new RegExp('^export (?:type|interface|enum|class|const|function|abstract class) ' + name + '\\b', 'm').test(source) ||
  new RegExp('^export (?:type )?\\{[^}]*\\b' + name + '\\b', 'm').test(source);

import * as m0 from '@/__tests__/harness';
import * as m1 from '@/app/api/artifacts/[id]/edits/route';
import * as m2 from '@/app/api/artifacts/[id]/fork/route';
import * as m3 from '@/app/api/artifacts/[id]/prepare/route';
import * as m4 from '@/app/api/artifacts/[id]/query/route';
import * as m5 from '@/app/api/artifacts/[id]/route';
import * as m6 from '@/app/api/artifacts/[id]/runs/route';
import * as m7 from '@/app/api/artifacts/preflight/route';
import * as m8 from '@/app/api/artifacts/reservations/route';
import * as m9 from '@/app/api/artifacts/route';
import * as m10 from '@/app/api/my/artifacts/[id]/annotations/route';
import * as m11 from '@/app/api/runner/operations/route';
import * as m12 from '@/lib/accounts';
import * as m13 from '@/lib/accounts/tokens';
import * as m14 from '@/lib/annotations';
import * as m15 from '@/lib/artifacts';
import * as m16 from '@/lib/datasets/execute';
import * as m17 from '@/lib/operations/http';
import * as m18 from '@/lib/operations/registry';
import * as m19 from '@/lib/platform/config';
import * as m20 from '@/lib/platform/db';
import * as m21 from '@/lib/platform/services';
import * as m22 from '@/lib/remote/agents';
import * as m23 from '@/lib/remote/comment-context';
import * as m24 from '@/lib/remote/hosted-interface';
import * as m25 from '@/lib/remote/hosted-proof';
import * as m26 from '@/lib/runner';
import * as m27 from '@/lib/runner/hosted-comments';
import * as m28 from '@/server/host';
import * as m29 from '@artifactbin/contracts';
import * as m30 from '@artifactbin/utils';

describe('values the deployment composes from', () => {
  it('@/__tests__/harness', () => {
    for (const name of ["mintAccountToken","request","useAppHarness"]) expect(name in m0, name).toBe(true);
  });
  it('@/app/api/artifacts/[id]/edits/route', () => {
    for (const name of ["POST"]) expect(name in m1, name).toBe(true);
  });
  it('@/app/api/artifacts/[id]/fork/route', () => {
    for (const name of ["POST"]) expect(name in m2, name).toBe(true);
  });
  it('@/app/api/artifacts/[id]/prepare/route', () => {
    for (const name of ["POST"]) expect(name in m3, name).toBe(true);
  });
  it('@/app/api/artifacts/[id]/query/route', () => {
    for (const name of ["POST"]) expect(name in m4, name).toBe(true);
  });
  it('@/app/api/artifacts/[id]/route', () => {
    for (const name of ["GET"]) expect(name in m5, name).toBe(true);
  });
  it('@/app/api/artifacts/[id]/runs/route', () => {
    for (const name of ["POST"]) expect(name in m6, name).toBe(true);
  });
  it('@/app/api/artifacts/preflight/route', () => {
    for (const name of ["POST"]) expect(name in m7, name).toBe(true);
  });
  it('@/app/api/artifacts/reservations/route', () => {
    for (const name of ["POST"]) expect(name in m8, name).toBe(true);
  });
  it('@/app/api/artifacts/route', () => {
    for (const name of ["POST"]) expect(name in m9, name).toBe(true);
  });
  it('@/app/api/my/artifacts/[id]/annotations/route', () => {
    for (const name of ["GET"]) expect(name in m10, name).toBe(true);
  });
  it('@/app/api/runner/operations/route', () => {
    for (const name of ["POST"]) expect(name in m11, name).toBe(true);
  });
  it('@/lib/accounts', () => {
    for (const name of ["claimToken","createUser","mintToken"]) expect(name in m12, name).toBe(true);
  });
  it('@/lib/accounts/tokens', () => {
    for (const name of ["MIN_TOKEN_TTL_MS","markRequestAuthority","mintToken"]) expect(name in m13, name).toBe(true);
  });
  it('@/lib/annotations', () => {
    for (const name of ["createAnnotationFor"]) expect(name in m14, name).toBe(true);
  });
  it('@/lib/artifacts', () => {
    for (const name of ["canReadArtifact","getArtifactById"]) expect(name in m15, name).toBe(true);
  });
  it('@/lib/datasets/execute', () => {
    for (const name of ["overrideCatalogExecutor"]) expect(name in m16, name).toBe(true);
  });
  it('@/lib/operations/http', () => {
    for (const name of ["runOperation"]) expect(name in m17, name).toBe(true);
  });
  it('@/lib/operations/registry', () => {
    for (const name of ["OPERATIONS"]) expect(name in m18, name).toBe(true);
  });
  it('@/lib/platform/config', () => {
    for (const name of ["BROWSER_SERVICE_URL","DATABASE_URL","PUBLIC_BASE_URL","RUNNER_ACTOR_SECRET","SQL_SERVICE_URL"]) expect(name in m19, name).toBe(true);
  });
  it('@/lib/platform/db', () => {
    for (const name of ["getDb","resetDb"]) expect(name in m20, name).toBe(true);
  });
  it('@/lib/platform/services', () => {
    for (const name of ["services","setServices"]) expect(name in m21, name).toBe(true);
  });
  it('@/lib/remote/agents', () => {
    for (const name of ["remoteAgents"]) expect(name in m22, name).toBe(true);
  });
  it('@/lib/remote/comment-context', () => {
    for (const name of ["readCommentContext"]) expect(name in m23, name).toBe(true);
  });
  it('@/lib/remote/hosted-interface', () => {
    for (const name of ["setHostedRemoteAgent"]) expect(name in m24, name).toBe(true);
  });
  it('@/lib/remote/hosted-proof', () => {
    for (const name of ["clearExternalHostedAgent"]) expect(name in m25, name).toBe(true);
  });
  it('@/lib/runner', () => {
    for (const name of ["runnerOperation"]) expect(name in m26, name).toBe(true);
  });
  it('@/lib/runner/hosted-comments', () => {
    for (const name of ["externalHostedComments","hostedCommentOperation"]) expect(name in m27, name).toBe(true);
  });
  it('@/server/host', () => {
    for (const name of ["externalHostedAgent"]) expect(name in m28, name).toBe(true);
  });
  it('@artifactbin/contracts', () => {
    for (const name of ["ACTOR_HEADER","ANONYMOUS","FORWARDED_FOR","FORWARDED_HOST","FORWARDED_PROTO","SERVICE_AUTH_HEADER","denyResponse","eventName","isInternalApiPath"]) expect(name in m29, name).toBe(true);
  });
  it('@artifactbin/utils', () => {
    for (const name of ["actorOf","actorReceiver","assemble","attachActor","buildAssetRequest","buildAssetResponse","createEnv","createTokenReader","envelope","eventsClient","fakeEvents","hostedAgentCallbackKey","hostedAgentDeliveryKey","hostedAgentSessionId","httpClient","inProcess","isPublicAssetRequest","log","noopEvents","overHttp","parseAssetsOrigin","parseDatasetPolicy","publicAssetResponse","runnerClient","serve","serviceSecretForServer","signActor","verifyActor"]) expect(name in m30, name).toBe(true);
  });
});

describe('types the deployment composes from', () => {
  it('@/lib/artifacts/mutation-invocation', () => {
    const source = sourceOf('@/lib/artifacts/mutation-invocation');
    for (const name of ["MutationContext"]) expect(exportsType(source, name), name).toBe(true);
  });
  it('@/lib/platform/db', () => {
    const source = sourceOf('@/lib/platform/db');
    for (const name of ["Db","Queryable"]) expect(exportsType(source, name), name).toBe(true);
  });
  it('@artifactbin/contracts', () => {
    const source = sourceOf('@artifactbin/contracts');
    for (const name of ["Actor","DatasetPolicy","EventEnvelope","EventPayload","EventVerb","EventsService","HostedAgentComment","HostedCredentialDescriptor","HostedOperationAuthorization","HostedRemoteAgent","ObjectKind","Part","Queryable","RunLookup","RunReceipt","RunSnapshot","RunStart","RunStatus","RunnerJson","RunnerLimits","RunnerService","TokenReader","Upstream"]) expect(exportsType(source, name), name).toBe(true);
  });
  it('@artifactbin/utils', () => {
    const source = sourceOf('@artifactbin/utils');
    for (const name of ["EventObject","EventSubject","FakeEvents"]) expect(exportsType(source, name), name).toBe(true);
  });
});
