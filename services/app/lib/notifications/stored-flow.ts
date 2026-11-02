/** Validation of persisted notification context snapshots; no source compiler is retained. */
import {z} from 'zod';
import {scalarMatches,type CompiledDataflow} from '@/lib/dataflow';
const columnType = z.enum(['string', 'number', 'boolean', 'date', 'timestamp', 'user']);
const constraints = z.object({ memberOf: z.array(z.string()).optional(), self: z.boolean().optional() }).strict();
const column = z.object({ name: z.string(), type: columnType, constraints: constraints.optional() }).strict();
const scalar = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const name = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/);
const span = { start: z.number().int().nonnegative(), end: z.number().int().nonnegative() };
const reads = z.object({ imports: z.array(z.string()), queries: z.array(z.string()), values: z.array(z.string()), builtins: z.array(z.string()) }).strict();
// Strict nested schemas: a record holds compiled declarations, never runtime state or ACL.
const compiledSchema = z.object({
  imports: z.array(z.object({ name, ref: z.string(), tables: z.array(z.object({ name: z.string(), columns: z.array(column) }).strict()) }).strict()),
  values: z.array(z.object({
    name, kind: z.enum(['scalar', 'table']), type: z.union([columnType, z.literal('table')]), default: scalar,
    rows: z.array(z.record(z.string(), scalar)).optional(), columns: z.array(column).optional(), url: z.literal(false).optional(),
    source: z.string().optional(), column: z.string().optional(), constraints: constraints.optional(),
  }).strict().refine((v) => v.kind === 'table' || (v.type !== 'table' && scalarMatches(v.default, v.type)))),
  queries: z.array(z.object({
    ...span, name, engine: z.enum(['sqlite', 'postgres']), source: z.string().optional(), sql: z.string(), params: z.array(z.string()), reads,
    columns: z.array(z.object({ name: z.string(), type: columnType.nullable() }).strict()),
  }).strict()),
  notifications: z.array(z.object({
    ...span, name, on: name, engine: z.enum(['sqlite', 'postgres']), source: z.string().optional(), sql: z.string(), params: z.array(z.string()), reads,
    columns: z.array(z.object({ name: z.string(), type: columnType.nullable() }).strict()).optional(),
  }).strict()).optional(),
  mutations: z.array(z.object({
    ...span, name, notifies: z.literal(true).optional(), sql: z.string(),
    target: z.union([z.object({ import: z.string(), table: z.string() }).strict(), z.object({ local: z.string() }).strict()]),
    args: z.array(z.object({ name: z.string(), type: columnType.nullable() }).strict()), reads,
    rowTypes: z.record(z.string(), columnType.nullable()).optional(), valueType: columnType.nullable().optional(),
    expectedAffected: z.number().int().nonnegative().optional(), reset: z.array(z.string()).optional(),
  }).strict()),
}).strict() as unknown as z.ZodType<CompiledDataflow>;

export function parseCompiledDataflow(value: unknown): CompiledDataflow | null {
  const parsed = compiledSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
