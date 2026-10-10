/**
 * A STORED ROW, compiled: how a row resolves as a `ref:` (its reach, then the link-readable
 * fallback), and its dataflow as the compiler answers it under the author's own reach. Below
 * store and dataflow, so the write path can store the compiled record and the runs can read it.
 */
import type { TokenActor } from '@/lib/accounts';
import type { DatasetAccessPolicy as DatasetPolicy } from '@artifactbin/contracts';
import { parseDatasetAccessPolicy } from '@artifactbin/utils';
import { EMPTY_COMPILED_DATAFLOW, EMPTY_DATAFLOW, initialTables, initialValues, isEmptyDataflow, type CompiledDataflow, type DatasetColumn, type QueryDecl, type Scalar } from '@/lib/dataflow';
import { compileWithLoader, type CompileResult } from '@/lib/dataflow/server';
import { executeCatalog } from '@/lib/datasets/execute';
import { catalogOf } from '@/lib/datasets/catalog';
import { DatasetError } from '@/lib/datasets/errors';
import { schemaLoaderFor, type ServerRef, type ServerRefLoader } from '@/lib/datasets/schema-loader';
import { declarationsOf } from '../document';
import { readCompiledDataflow } from '@/lib/document/server';
import type { ValidationError } from '@/lib/jsx';
import { sqlExtensions } from '@/lib/sql/extensions';
import type { RanDataflow, StoryIslandDataflow } from '@/lib/story-runtime/contract';
import { CHILDREN_COLUMNS } from './placement';
import { getArtifact, getArtifactFor, getLinkReadableArtifact } from './rows';
import { writerFor, type ArtifactRow } from './table';

export function refLoaderForActor(actor: TokenActor): ServerRefLoader {
  if(actor.groupId)return async id=>{const own=await getArtifactFor(actor,id);const row=own??await getLinkReadableArtifact(id);return row?rowToResolvedRef(row,!!own):null;};
  return actor.userId ? refLoaderForUser(actor.userId) : refLoaderFor(actor.tokenId);
}

/** A stored policy the publish door can analyze against, or nothing at all:
 * an unreadable policy is the write door's refusal to make, not a publish's. */
function parsedDatasetPolicy(row: ArtifactRow): DatasetPolicy | undefined {
  if (!row.dataset_policy) return undefined;
  try { return parseDatasetAccessPolicy(row.dataset_policy); } catch { return undefined; }
}

export function rowToResolvedRef(row: ArtifactRow, owned = false): ServerRef {
  const meta = (row.meta ?? {}) as { columns?: DatasetColumn[] };
  const catalog = row.format === 'dataset' ? catalogOf(row) : null;
  return {
    id: row.id,
    format: row.format,
    validationState:{id:row.id,version:row.version,sharingRevision:row.sharing_revision??0,policyRevision:row.policy_revision??0},
    owned,
    ...(row.format === 'dataset' ? { columns: meta.columns ?? [], access: row.access, catalog:catalog??undefined, datasetPolicy:parsedDatasetPolicy(row), query: async(sql:string,params:Record<string,Scalar>,paramTypes?:Record<string,DatasetColumn["type"]>) => {
      if(!catalog)throw new DatasetError(`Dataset source ref:${row.id} has no catalog or stored object key`);
      return executeCatalog(catalog,sql,params,{datasetId:row.id,limit:1,refresh:true,paramTypes});
    } } : {}),
    // A folder's shape is FIXED and computed, never stored — the compiler needs
    // it to judge a <Query> over an <Import> of the folder (`<name>.rows`).
    ...(row.format === 'folder' ? { columns: CHILDREN_COLUMNS } : {}),
    ...(row.format === 'viz' ? { recipe: JSON.parse(row.source ?? '') } : {}),
  };
}

/**
 * A document's compiled dataflow as the compiler answers it: the record its
 * publish stored, or — stale, missing, compiled by an older compiler — a fresh
 * compile under the document's own reach (the author's scope, as every read
 * resolves), with the compiler's errors when the source no longer compiles.
 * Null when there is nothing to compile: no source, or a source that does not parse.
 */
export async function compileResultForRow(row: CompilableRow): Promise<CompileResult | null> {
  if (!row.source) return null;
  return readCompiledDataflow(row.meta, row.source, schemaLoaderFor(refLoaderForActor(writerFor(row))), { extensions: sqlExtensions() });
}

export type CompilableRow = Pick<ArtifactRow, 'id' | 'version' | 'source' | 'meta' | 'token_id' | 'user_id'>;

/** {@link compileResultForRow} for callers that only act on a document that compiles: null otherwise. */
export async function compiledForRow(stored: CompilableRow): Promise<CompiledDataflow | null> {
  const result = await compileResultForRow(stored);
  return result?.ok ? result.compiled : null;
}

/** Compile errors as publish reports them, one per line: each names its declaration. */
export const compileErrorText = (errors: ValidationError[]): string => errors.map((e) => e.message).join('\n');

/**
 * A DOCUMENT THAT CANNOT RUN, as state that has already run: its Values at
 * their defaults and every query answering why — so nothing runs, the reader
 * never fetches, and no query is ever silent. Declarations come from the
 * Helmet; only the Values are compiled. The cause: a document whose data half
 * does not compile (what it imports changed shape since publish, or its store
 * is unreachable): each query answers with its own compile errors, or the
 * document's when it has none — by declaration name, as publish would have
 * refused it.
 */
async function unrunnableDataflow(row: Pick<ArtifactRow, 'source' | 'token_id' | 'user_id'>, answer: (query: QueryDecl) => string): Promise<RanDataflow | null> {
  const declared = declarationsOf(row.source ?? '');
  if (!declared || isEmptyDataflow(declared)) return null;
  const compiled = await compileWithLoader({ ...EMPTY_DATAFLOW, values: declared.values }, schemaLoaderFor(refLoaderForActor(writerFor(row))), { extensions: sqlExtensions() });
  const flow = compiled.ok ? compiled.compiled : EMPTY_COMPILED_DATAFLOW;
  return { flow, state: { values: initialValues(flow), tables: initialTables(flow), errors: Object.fromEntries(declared.queries.map((q) => [q.name, answer(q)])) } };
}

/** A declaration's own compile errors (by source span), else the document's. */
const errorsOf = (errors: ValidationError[]) => (declaration: { start: number; end: number }): string => {
  const own = errors.filter((e) => e.start !== undefined && e.start >= declaration.start && (e.end ?? e.start) <= declaration.end);
  return compileErrorText(own.length ? own : errors);
};

export async function declarationsForRow(row: CompilableRow): Promise<StoryIslandDataflow | null> {
  let result: CompileResult | null;
  // Loading what the document imports can fail too (the store is unreachable): that is said, not swallowed.
  try { result = await compileResultForRow(row); }
  catch (error) { return unrunnableDataflow(row, () => `The document's data could not be compiled: ${error instanceof Error ? error.message : String(error)}`); }
  if (!result) return null;
  if (!result.ok) return unrunnableDataflow(row, errorsOf(result.errors));
  return isEmptyCompiled(result.compiled) ? null : { flow: result.compiled };
}

export const isEmptyCompiled = (flow: CompiledDataflow): boolean =>
  !flow.imports.length && !flow.values.length && !flow.queries.length && !flow.mutations.length;

/** Resolve a `ref:<id>`: the caller's own artifacts, then anything link-readable. */
function refLoaderFor(tokenId: string): ServerRefLoader {
  return async (id: string): Promise<ServerRef | null> => {
    // `owned` records WHICH branch answered: a read is happy either way, a
    // <Mutation> is admitted only for the caller's own (lib/dataflow/refs).
    const own = await getArtifact(tokenId, id);
    const row = own ?? (await getLinkReadableArtifact(id));
    if (!row) return null;
    return rowToResolvedRef(row, !!own);
  };
}

/** Same, scoped by account (the session-authed /api/my routes) before the link-readable fallback. */
function refLoaderForUser(userId: string): ServerRefLoader {
  return async (id: string): Promise<ServerRef | null> => {
    const own = await getArtifactFor({userId,tokenId:''}, id);
    const row = own ?? (await getLinkReadableArtifact(id));
    if (!row) return null;
    return rowToResolvedRef(row, !!own);
  };
}
