/** What this command does and how to use it; also printed by --help. */
export const DESCRIPTION = `Dataset permissions: who can see, add, change and delete rows.
Rules use Hasura's permission format (version 3); owners and editors always have full access.
Usage: node scripts/policy.mjs get DATASET_ID [--output policy.json]
       node scripts/policy.mjs explain DATASET_ID
       node scripts/policy.mjs template read-only|own-rows|editors-only DATASET_ID
         [--owner-column COLUMN] [--output policy.json]
       node scripts/policy.mjs set DATASET_ID --file policy.json [--dry-run]
         [--expected-revision N]
Flags: --file FILE a v3 policy, or the output of get/template (its policy and revision are used);
  --dry-run validates and prints the read-back without saving; --expected-revision N the revision
  get printed (required with a bare policy file); --owner-column COLUMN the column own-rows stamps
  with the writer's user ID. Common: --server, --json, --output FILE (exclusive), --help.
Examples:
  node scripts/policy.mjs get DATASET_ID --output policy.json
  node scripts/policy.mjs template own-rows DATASET_ID --owner-column created_by --output p.json
  node scripts/policy.mjs set DATASET_ID --file p.json --dry-run
  node scripts/policy.mjs set DATASET_ID --file p.json
Gotchas: only owners and editors read or set permissions. Rule roles are viewer (shared viewers),
  signed_in (signed-in link holders) and anonymous (signed-out link holders); each request matches
  exactly one, so list every role a rule is for. Rules name source columns (the names sql
  reads). configuration is server-owned: leave it out or unchanged. Run --dry-run first and
  read readBack: it says in plain words what each role can do. A revision conflict means
  someone else changed the permissions or the dataset: get again, reapply, set. Session
  values: X-Hasura-User-Id, X-Hasura-Page-Id, X-Hasura-Role.
Exit: 0 ok; 1 failed; 2 invalid (policy errors are listed by JSON path); 3 auth/access;
  4 revision conflict; 5 unknown save outcome (get shows the revision; a repeated set at the old
  revision cannot apply twice). Results never contain credentials.`;

import {
  runTool,
  resolveTarget,
  selectedServer,
  makeClient,
  integer,
  positional,
  requireFlags,
  enumValue,
  jsonFile,
  ToolError
} from './toolbox-client.mjs';

const TEMPLATES = ['read-only', 'own-rows', 'editors-only'];
const lines = text => String(text ?? '').split('\n').filter(Boolean);

/** The policy and revision a --file holds: a bare v3 policy, or a get/template output envelope. */
async function policyFile(file) {
  const value = await jsonFile(file);
  const wrapped = Boolean(value && typeof value === 'object' && value.policy &&
    typeof value.policy === 'object');
  const policy = wrapped ? value.policy : value;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy) || policy.version !== 3)
    throw new ToolError('policy_version_unsupported', 'The file holds no version 3 policy.', 2,
      'Start from policy.mjs get or template --output FILE and edit its policy.');
  const revision = wrapped && Number.isSafeInteger(value.revision) ? value.revision : undefined;
  return {policy, revision};
}

/** A refused policy names every problem by JSON path (exit 2); a conflict says how to recover. */
function refusal(error) {
  if (error?.code === 'invalid_policy')
    return new ToolError('invalid_policy', 'The policy is invalid; nothing was saved.', 2,
      'Fix each entry in details.errors (JSON path and message), then set --dry-run again.',
      error.details);
  if (error?.code === 'policy_changed')
    return new ToolError('policy_changed', 'The permissions or the dataset changed since get.', 4,
      'Run policy.mjs get ID --output fresh.json, reapply your change there and set it.',
      error.details);
  return error;
}

export async function policyCommand({sub, values, positionals}, options = {}) {
  const args = sub === 'template' ? positionals.slice(1) : positionals;
  if (sub === 'template') {
    if (positionals.length !== 2)
      throw new ToolError('invalid_arguments', 'Expected NAME and DATASET_ID.', 2, 'Read --help.');
    enumValue(positionals[0], TEMPLATES, 'template');
  }
  if (sub === 'set') requireFlags(values, ['file']);
  const {server, id} = resolveTarget(positional(args), selectedServer(values, options.env)),
    client = makeClient(server, options),
    route = `/api/artifacts/${id}/policy`;
  try {
    if (sub === 'get') return await client.request(route);
    if (sub === 'explain') {
      const read = await client.request(route);
      return {revision: read.revision, source: read.source, readBack: lines(read.readBack),
        warnings: read.warnings, report: read.report};
    }
    if (sub === 'template') {
      const owner = values['owner-column'];
      const listed = await client.request(`${route}/templates${owner ?
        '?ownerColumn=' + encodeURIComponent(owner) : ''}`);
      const found = listed.templates.find(t => t.name === positionals[0]);
      if (!found?.ok)
        throw new ToolError('invalid_template', 'This template does not fit the dataset.', 2,
          'Fix each entry in details.errors (own-rows needs --owner-column COLUMN).',
          {errors: found?.errors ?? []});
      return {template: found.name, revision: listed.revision, policy: found.policy,
        readBack: found.readBack, warnings: found.warnings};
    }
    const {policy, revision} = await policyFile(values.file);
    const dryRun = Boolean(values['dry-run']);
    const expected = values['expected-revision'] !== undefined ?
      integer(values['expected-revision'], 'expected_revision', 0) : revision;
    if (!dryRun && expected === undefined)
      throw new ToolError('missing_expected_revision',
        '--expected-revision is required with a bare policy file.', 2,
        'Pass the revision policy.mjs get printed, or set the file get/template wrote.');
    const saved = await client.request(route, {
      method: 'PUT',
      body: {policy, ...(dryRun ? {dryRun: true} : {}),
        ...(expected !== undefined ? {expectedPolicyRevision: expected} : {})},
      unsafe: !dryRun,
      safeToRepeat: dryRun
    });
    return {...saved, readBack: lines(saved.readBack)};
  } catch (error) {
    throw refusal(error);
  }
}
await runTool('policy', import.meta.url, policyCommand);
