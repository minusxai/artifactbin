import { registeredPageLifecycle, pageSourceDigest } from '@/lib/registered-page-lifecycle';
import type { QueryPlan } from './contracts';
import { prepare } from './model';
import { registeredQuerySchema } from './namespace';

export { pageSourceDigest } from '@/lib/registered-page-lifecycle';
type RegisteredQueryProgram = Omit<QueryPlan, 'registration'>;
interface QueryProvenance { compilerSha256: string; sourceSha256: string; sqlEngineSha256: string }
export class RegisteredQueryRebindError extends Error {
  constructor(readonly namespace: string, readonly reason: string) {
    super(`registered queries '${namespace}' cannot be re-bound: ${reason}`);
  }
}
const lifecycle = registeredPageLifecycle<RegisteredQueryProgram, QueryProvenance>({
  kind: 'registered-page-queries-v1',
  error: 'query',
  provenanceKeys: ['compilerSha256', 'sourceSha256', 'sqlEngineSha256'],
  schema: registeredQuerySchema,
  validate(program, page, backendId) {
    prepare({ ...program, registration: { pageId: page.pageId, pageVersion: page.version, backendId,
      backendVersion: 'pending', sourceSha256: pageSourceDigest(page.html) } }, { values: {}, only: [] });
  },
  rebindError: (namespace, reason) => new RegisteredQueryRebindError(namespace, reason),
});
export const prepareRegisteredQueryBackend = lifecycle.prepare;
export const registeredPlan = lifecycle.plan;
export const commitRegisteredQueryBackend = lifecycle.commit;
export const planRegisteredQueryRebinds = lifecycle.rebind;
export const commitRegisteredQueryRebinds = lifecycle.commitRebinds;
export const planRegisteredQueryRepair = lifecycle.repair;
export type RegisteredQueryRebind = Awaited<ReturnType<typeof planRegisteredQueryRebinds>>['rebinds'][number];
