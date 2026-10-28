/** What this command does and how to use it; also printed by --help. */
export const DESCRIPTION = `Read a page's GraphQL schema or run a query or mutation.
It targets the page's linked dataset and backend namespaces.
Usage: node scripts/graphql.mjs schema ID|URL [--revision N]
       node scripts/graphql.mjs query|mutate ID|URL --document FILE [--operation NAME]
         [--variables FILE] [--revision N]
Flags: --document FILE (required for query/mutate); --operation NAME (required when the document
  has several); --variables FILE a JSON object; --revision N a saved page revision (default:
  current). Common: --server, --json, --help.
Examples:
  node scripts/graphql.mjs schema ID
  node scripts/graphql.mjs query ID --document q.graphql --variables vars.json
Gotchas: the operation is validated against the saved SDL first; use schema for exact names.
  query is safe to repeat; mutate can write data. Exit 5 means a mutation outcome is unknown:
  reconcile by reading before any new write. Errors or non-committed outcomes fail the command.
Exit: 0 ok; 1 failed; 2 invocation; 3 auth/access; 4 conflict; 5 unknown write outcome.
  Results never contain credentials.`;

import {readFile} from 'node:fs/promises';
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
import {selectedOperation} from './toolbox-graphql.mjs';
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
  if (sub === 'schema') return schema;
  const variables = values.variables ? await jsonFile(values.variables) : {};
  if (!variables || typeof variables !== 'object' || Array.isArray(variables))
    throw new ToolError('invalid_variables', 'Variables must be a JSON object.', 2);
  const {parse, validate, buildSchema} = await platform();
  const errors = validate(buildSchema(schema.sdl), parse(document));
  if (errors.length)
    throw new ToolError(
      'graphql_validation',
      'Operation does not match the saved page SDL.',
      2,
      'Use graphql.mjs schema for exact names.',
      {errors: errors.map(error => error.message)}
    );
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
