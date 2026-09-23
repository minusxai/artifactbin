import type { DatasetAction, DatasetGrantContext, DatasetGrantPolicy, DatasetPrincipal, DatasetMutationPolicy, DatasetOperation, Scalar } from '@artifactbin/contracts';
import { parseDatasetPolicy, viewersWritePolicy } from './dataset-policy';

const actions: readonly DatasetAction[] = ['read', 'insert', 'update', 'delete'];
const mutations: DatasetOperation[] = ['insert', 'update', 'delete'];
function invalid(message: string): never { throw new Error(`Dataset grants: ${message}`); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('expected an object');
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: string[]) {
  for (const field of Object.keys(value)) if (!allowed.includes(field)) invalid(`unsupported field ${field}`);
}

/** Parse independently of v1. Do not infer permissive defaults from incomplete policies. */
export function parseDatasetGrants(value: unknown): DatasetGrantPolicy {
  if (JSON.stringify(value)?.length > 64_000) invalid('maximum size is 64 KB');
  const p = record(value);
  fields(p, ['version', 'allow', 'tables', 'execution']);
  if (p.version !== 2) invalid('expected version 2');
  if (!Array.isArray(p.allow) || p.allow.length > 64) invalid('allow must contain at most 64 grants');
  for (const entry of p.allow) {
    const grant = record(entry);
    fields(grant, ['actions', 'from']);
    if (!Array.isArray(grant.actions) || !grant.actions.length || new Set(grant.actions).size !== grant.actions.length || grant.actions.some(a => !actions.includes(a))) invalid('expected unique supported actions');
    const selector = record(grant.from);
    fields(selector, ['user', 'artifact', 'artifactOwner']);
    if (!Object.keys(selector).length) invalid('from requires at least one selector');
    for (const [field, target] of Object.entries(selector)) {
      if (typeof target !== 'string' || !(target === '*' || (target === '$owner' && field !== 'artifact') || /^[A-Za-z0-9_-]{1,128}$/.test(target))) invalid(`${field} requires a stable ID, * or permitted $owner binding`);
      if (field === 'artifact' && target !== '*' && !/^[A-Za-z0-9]{6,128}$/.test(target)) invalid('artifact requires a stable artifact ID');
    }
  }
  // Reuse the existing, strict predicate/column/function grammar, preserving omission.
  const restricted = parseDatasetPolicy({ version: 1, enforcement: 'enabled', tables: Object.hasOwn(p, 'tables') ? p.tables : [], ...(p.execution === undefined ? {} : { execution: p.execution }) });
  for (const table of restricted.tables) for (const operation of mutations) {
    if (table[`${operation}_permissions`]?.some(entry => entry.role !== 'viewer')) invalid('restrictions use the viewer role');
  }
  return JSON.parse(JSON.stringify(p)) as DatasetGrantPolicy;
}

export function defaultDatasetGrants(): DatasetGrantPolicy {
  return { version: 2, allow: [
    { actions: ['read'], from: { user: '*' } },
    { actions: ['insert', 'update', 'delete'], from: { artifactOwner: '$owner' } },
  ] };
}

function samePrincipal(left: DatasetPrincipal, right: DatasetPrincipal): boolean {
  if (left.userId || right.userId) return !!left.userId && left.userId === right.userId;
  return !!left.tokenId && left.tokenId === right.tokenId;
}
function person(target: string, principal: DatasetPrincipal, owner: DatasetPrincipal): boolean {
  return target === '*' || (target === '$owner' ? samePrincipal(principal, owner) : !!principal.userId && principal.userId === target);
}

/** Selector matching only. The app must establish artifact access/membership before supplying its context. */
export function datasetGrantAllows(policy: DatasetGrantPolicy, action: DatasetAction, context: DatasetGrantContext): boolean {
  return policy.allow.some(grant => grant.actions.includes(action) && Object.entries(grant.from).every(([field, target]) => {
    if (field === 'user') return person(target, context.caller, context.owner);
    if (!context.artifact) return false;
    if (field === 'artifact') return target === '*' || target === context.artifact.id;
    if (field === 'artifactOwner') return person(target, context.artifact.owner, context.owner);
    return false;
  }));
}

/** Compile grants into the SQL engine's existing operation + row restriction contract. */
export function grantMutationPolicy(policy: DatasetGrantPolicy, context: DatasetGrantContext, table: {schema:string;name:string}, session: Record<string,Scalar>): DatasetMutationPolicy | undefined {
  const operations = mutations.filter(operation => datasetGrantAllows(policy, operation, context));
  if (!operations.length) return undefined;
  const selected = policy.tables === undefined ? viewersWritePolicy(table).tables[0] : policy.tables.find(t => t.table.schema === table.schema && t.table.name === table.name);
  if (!selected) return undefined;
  return { table: selected, role: 'viewer', session, operations, ...(policy.execution === undefined ? {} : { execution: policy.execution }) };
}

/** Fork mappings replace copied artifact IDs, never literal users or $owner. */
export function remapDatasetGrants(policy: DatasetGrantPolicy, artifacts: Readonly<Record<string,string>>): DatasetGrantPolicy {
  return { ...policy, allow: policy.allow.map(grant => ({ ...grant, from: { ...grant.from, ...(grant.from.artifact && Object.hasOwn(artifacts, grant.from.artifact) ? { artifact: artifacts[grant.from.artifact]! } : {}) } })) };
}

/** Persisted policy discriminator; legacy documents retain their exact semantics. */
export function parseDatasetAccessPolicy(value: unknown): import('@artifactbin/contracts').DatasetAccessPolicy {
  return value && typeof value==='object' && 'version' in value && value.version===2 ? parseDatasetGrants(value) : parseDatasetPolicy(value);
}
