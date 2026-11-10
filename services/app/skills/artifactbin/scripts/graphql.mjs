/** Older pages (gql) only; new pages use sql.mjs. What it does and how; also printed by --help. */
export const DESCRIPTION = `Older pages only: GraphQL for pages published before sql.
New pages read and write datasets with sql: use node scripts/sql.mjs (sql.mjs --help).
Usage: node scripts/graphql.mjs schema ID|URL [--revision N]
       node scripts/graphql.mjs query|mutate ID|URL --document FILE [--operation NAME]
         [--variables FILE] [--revision N] [--idempotency-key KEY]
Flags: --document FILE, --operation NAME, --variables FILE, --revision N, --idempotency-key KEY
  (a dataset mutation's replay key). Common: --server, --json, --help.
Examples:
  node scripts/graphql.mjs schema ID
Gotchas: exit 5 means a mutation's outcome is unknown: read before any new write.
Exit: 0 ok; 1 failed; 2 invocation; 3 auth/access; 4 conflict; 5 unknown write outcome.`;

import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {
  runTool,
  resolveTarget,
  selectedServer,
  makeClient,
  integer,
  positional,
  requireFlags,
  jsonFile,
  platform,
  ToolError
} from './toolbox-client.mjs';
import {selectedOperation,datasetFailure} from './toolbox-graphql.mjs';
// schema prints the SDL; query and mutate validate the document against it locally, then send it.
export async function graphqlCommand({sub, values, positionals}, options = {}) {
  const {server, id} = resolveTarget(positional(positionals), selectedServer(values, options.env)),
    client = makeClient(server, options);
  const revision = values.revision ? String(integer(values.revision, 'revision')) : undefined;
  let document;
  if (sub !== 'schema') {
    requireFlags(values, ['document']);
    document = await readFile(values.document, 'utf8');
    await selectedOperation(document, values.operation, sub);
  }
  const schema = await client.request(
    `/api/artifacts/${id}/graphql${revision ? '?revision=' + revision : ''}`
  );
  // The dataset reply carries the caller's role (DatasetGraphqlSchemaReply); a page's never does.
  const dataset = typeof schema.role === 'string';
  if (dataset && revision)
    throw new ToolError('revision_unsupported', 'A dataset serves its current rows only.', 2,
      'Drop --revision for a dataset ID.');
  if (!dataset && values['idempotency-key'])
    throw new ToolError('idempotency_key_unsupported', 'Only dataset mutations take a key.', 2,
      'Drop --idempotency-key for a page ID.');
  if (sub === 'schema') return dataset ? {target: 'dataset', ...schema} : schema;
  const variables = values.variables ? await jsonFile(values.variables) : {};
  if (!variables || typeof variables !== 'object' || Array.isArray(variables))
    throw new ToolError('invalid_variables', 'Variables must be a JSON object.', 2);
  const {parse, validate, buildSchema} = await platform();
  const built = buildSchema(schema.sdl);
  const errors = validate(built, parse(document)).map(error => error.message);
  // validate() accepts a mutation against a schema without a Mutation root; the server would not.
  if (sub === 'mutate' && !built.getMutationType())
    errors.push('This schema has no mutations: your role may not write here.');
  if (errors.length)
    throw new ToolError(
      'graphql_validation',
      `Operation does not match the saved ${dataset ? 'dataset' : 'page'} SDL.`,
      2,
      'Use graphql.mjs schema for exact names.',
      {errors}
    );
  if (dataset) {
    // One key per mutation: the server answers a repeat with the first reply and writes nothing.
    const key = sub === 'mutate' ? values['idempotency-key'] ?? randomUUID() : undefined;
    let result;
    try {
      result = await client.request(`/api/artifacts/${id}/graphql`, {
        method: 'POST',
        body: {query: document, variables, ...(values.operation ?
          {operationName: values.operation} : {})},
        ...(key ? {headers: {'Idempotency-Key': key}} : {}),
        unsafe: sub === 'mutate',
        safeToRepeat: sub !== 'mutate'
      });
    } catch (error) {
      throw datasetFailure(error, key);
    }
    if (result.errors?.length) throw datasetFailure(result, key);
    return key ? {...result, idempotencyKey: key} : result;
  }
  // Only queries are safe to repeat; a mutation is sent once and an unknown outcome exits 5.
  const result = await client.request(`/api/artifacts/${id}/graphql`, {
    method: 'POST',
    body: {
      query: document,
      revision: schema.revision,
      variables,
      ...(values.operation ? {operationName: values.operation} : {})
    },
    unsafe: sub === 'mutate',
    safeToRepeat: sub !== 'mutate'
  });
  const outcomes = Object.values(result.extensions?.outcomes ?? {});
  if (result.errors?.length || outcomes.some(outcome => outcome !== 'committed'))
    throw new ToolError(
      outcomes.includes('unknown') ? 'outcome_unknown' : 'graphql_failed',
      'GraphQL returned errors or noncommitted outcomes.',
      outcomes.includes('unknown') ? 5 : 1,
      'Inspect errors/outcomes; reconcile unknown mutations before any new write.',
      result
    );
  return result;
}
await runTool('graphql', import.meta.url, graphqlCommand);
