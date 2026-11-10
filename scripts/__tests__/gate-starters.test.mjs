/**
 * A browser gate drives a skill starter only through the API that starter still ships.
 *
 * #1200 turned the skill's starters into function files (`fetch('/fn/NAME')`, `sql`…``, `@afbin/state`): their backend
 * files export no typeDefs, so no GraphQL field names them, and `_sql`/`_aggregate` roots are gone. Its unit tests
 * followed; two gates did not (live-cells mutated `tracker { add(…) }` and counted with `_sql`, offline-file published
 * the tracker beside `client.mutate` of it), and main went red after merge. This scan runs in pr fast: a gate or gate
 * fixture that uses a starter (examples/*.ts, toolbox-tracker's files) must not reach it the retired way. Gates that
 * cover the legacy GraphQL door on their own pages and datasets (no starter) are untouched.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SKILL = 'services/app/skills/artifactbin';
/** A spec uses a starter when it reads a starter backend file or builds the tracker from its generator. */
const USES_STARTER = /skills\/artifactbin\/(?:examples\/[\w-]+\.ts\b|scripts\/toolbox-tracker\.mjs)/;
const RETIRED = [
  [/\bclient\.mutate\s*\(/, 'client.mutate (a starter writes with sql`…` or fetch(\'/fn/NAME\'))'],
  [/\b_sql\b/, '_sql (the page counts with sql`…`)'],
  [/\b\w+_aggregate\b/, '_aggregate roots (totals use SQL)'],
  [/extensions\?*\.outcomes/, 'GraphQL extensions.outcomes (a function answers its own JSON)'],
  [/\btypeDefs\b/, 'typeDefs (starter backends are function files)'],
];

/** Each way SOURCE (a gate or gate fixture) reaches a starter that the skill no longer ships; [] when it uses none. */
function retiredStarterUses(source) {
  if (!USES_STARTER.test(source)) return [];
  const found = RETIRED.filter(([re]) => re.test(source)).map(([, what]) => what);
  // A function file's namespace (`resolverSources: { tracker: … }`, `data-af-name="tracker"` on an af-resolver link)
  // selected as a GraphQL field: `tracker { add(` or `tracker{add{`.
  const namespaces = new Set([
    ...[...source.matchAll(/resolverSources\s*:\s*\{([^}]*)\}/g)].flatMap((m) => [...m[1].matchAll(/(?:^|,)\s*['"]?(\w+)['"]?\s*:/g)].map((n) => n[1])),
    ...[...source.matchAll(/rel="af-resolver"[^>]*data-af-name="(\w+)"|data-af-name="(\w+)"[^>]*rel="af-resolver"/g)].map((m) => m[1] ?? m[2]),
  ]);
  for (const name of namespaces) {
    if (new RegExp(`\\b${name}\\s*\\{\\s*\\w+\\s*[({]`).test(source)) found.push(`a GraphQL selection of the function file "${name}" (call fetch('/fn/NAME') or POST /api/artifacts/PAGE/fn/NAME)`);
  }
  return found;
}

const specs = ['scripts/gates', 'scripts/gates/lib', 'scripts/fixtures'].flatMap((dir) =>
  readdirSync(path.join(ROOT, dir), { withFileTypes: true }).filter((e) => e.isFile() && /\.m?js$/.test(e.name)).map((e) => `${dir}/${e.name}`));

describe('gates reach skill starters only through the API the starters ship', () => {
  it('finds the gates that use a starter (the scan is not vacuous)', () => {
    const using = specs.filter((file) => USES_STARTER.test(readFileSync(path.join(ROOT, file), 'utf8')));
    expect(using).toEqual(expect.arrayContaining(['scripts/gates/gate-live-cells.mjs', 'scripts/gates/gate-offline-file.mjs']));
  });

  it.each(specs)('%s uses no retired starter API', (file) => {
    expect(retiredStarterUses(readFileSync(path.join(ROOT, file), 'utf8'))).toEqual([]);
  });

  it('the premise holds: every starter backend the skill ships is a function file, with no typeDefs', () => {
    const examples = readdirSync(path.join(ROOT, SKILL, 'examples')).filter((name) => name.endsWith('.ts'));
    expect(examples.length).toBeGreaterThan(0);
    for (const name of examples) expect(readFileSync(path.join(ROOT, SKILL, 'examples', name), 'utf8'), name).not.toMatch(/export\s+const\s+typeDefs\b/);
  });

  it('refuses the flows that reached main red in #1200', () => {
    const tracker = "import { trackerFiles } from '../../services/app/skills/artifactbin/scripts/toolbox-tracker.mjs';\nconst page = await api('/api/artifacts', { body: JSON.stringify({ html, resolverSources: { tracker: files['tracker.ts'] } }) });\n";
    expect(retiredStarterUses(`${tracker}await gql('mutation($n: String!) { tracker { add(name: $n, grp: "Done") { _id } } }');`)).toEqual([expect.stringContaining('"tracker"')]);
    expect(retiredStarterUses(`${tracker}check(text === '3 of 3', 'the page counts the group with _sql');`)).toEqual([expect.stringContaining('_sql')]);
    const offline = "<link rel=\"af-resolver\" data-af-name=\"tracker\" href=\"./tracker.ts\">\nconst r=await client.mutate({mutation:gql`mutation {tracker{add(name:\"Offline\",grp:\"Later\"){_id}}}`});r.extensions?.outcomes['tracker.add'];\nreadFileSync(path.join(ROOT, 'services/app/skills/artifactbin/examples/tracker.ts'), 'utf8')";
    expect(retiredStarterUses(offline)).toHaveLength(3);
    // The new flows pass, and a gate with no starter may keep covering the legacy GraphQL door.
    expect(retiredStarterUses(`${tracker}await fetch(\`\${BASE}/api/artifacts/\${id}/fn/add\`, { method: 'POST' });`)).toEqual([]);
    expect(retiredStarterUses("const r=await client.mutate({mutation:gql`mutation{insert_sales_one(object:{amount:9}){_id}}`});")).toEqual([]);
  });
});
