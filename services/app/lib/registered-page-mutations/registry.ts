import type { HtmlBackendLink, HtmlPageVersion } from '@artifactbin/contracts';
import type { HtmlBackendVersionRecord } from '@/lib/html-backends';
import { registeredPageLifecycle, type BoundPage } from '@/lib/registered-page-lifecycle';
import type { MutationProgram } from './contracts';
import { validateMutationProgram } from './model';
import { registeredMutationSchema } from './namespace';

interface MutationProvenance { compilerSha256: string; sourceSha256: string }
export class RegisteredMutationRebindError extends Error {
  constructor(readonly namespace: string, readonly reason: string) {
    super(`registered mutations '${namespace}' cannot be re-bound: ${reason}`);
  }
}
const lifecycle = registeredPageLifecycle<MutationProgram, MutationProvenance>({
  kind: 'registered-page-mutations-v1',
  error: 'mutation',
  provenanceKeys: ['compilerSha256', 'sourceSha256'],
  schema: registeredMutationSchema,
  validate: validateMutationProgram,
  rebindError: (namespace, reason) => new RegisteredMutationRebindError(namespace, reason),
});
export const prepareRegisteredMutationBackend = lifecycle.prepare;
/** Mutations additionally require the exact link in the page's published namespace set. */
export function registeredMutationPlan(page: BoundPage & Pick<HtmlPageVersion, 'links'>, link: HtmlBackendLink, backend: HtmlBackendVersionRecord) {
  if (!backend.compiled.startsWith('!registered-page-mutations-v1\n')) return null;
  if (!page.links.some(value => value.kind === 'backend' && value.name === link.name && value.backendId === link.backendId && value.version === link.version))
    throw Error('mutation_registration_changed');
  return lifecycle.plan(page, link, backend);
}
export const commitRegisteredMutationBackend = lifecycle.commit;
export const planRegisteredMutationRebinds = lifecycle.rebind;
export const commitRegisteredMutationRebinds = lifecycle.commitRebinds;
export const planRegisteredMutationRepair = lifecycle.repair;
export type RegisteredMutationRebind = Awaited<ReturnType<typeof planRegisteredMutationRebinds>>['rebinds'][number];
