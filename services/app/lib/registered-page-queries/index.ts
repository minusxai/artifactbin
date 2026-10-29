/** The registered-page-queries module's interface: what code outside lib/registered-page-queries imports (rule 4, scripts/ci/module-graph.mjs). */
export { QUERY_LIMITS } from './contracts';
export type { QueryContext } from './contracts';
export { readRegisteredQueryMembers } from './members';
export { registeredQueryInvoker } from './namespace';
export {
  RegisteredQueryRebindError, commitRegisteredQueryBackend, commitRegisteredQueryRebinds, pageSourceDigest, planRegisteredQueryRebinds,
  planRegisteredQueryRepair, prepareRegisteredQueryBackend, registeredPlan,
} from './registry';
export type { RegisteredQueryRebind, RegisteredRepair, RepairableHead } from './registry';
export { createRegisteredPageQueries } from './service';
export { registeredSourceCatalog } from './source-catalog';
