/**
 * A browser gate drives a skill starter only through the API that starter still ships.
 *
 * The skill's starters read and write datasets with `sql`…`` and keep viewer state in `@afbin/state`; no starter has
 * server code (page functions are gone), and `_sql`/`_aggregate` roots are gone. Gates once lagged their starters
 * and main went red after merge. This scan runs in pr fast: a gate or gate fixture that uses a starter (the tracker
 * from toolbox-tracker's files, or an examples/ page) must not reach it the retired way. Gates that cover the legacy
 * GraphQL door on their own pages and datasets (no starter) are untouched.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
/** A spec uses a starter when it reads a starter page or builds the tracker from its generator. */
const USES_STARTER = /skills\/artifactbin\/(?:examples\/[\w-]+\.html\b|scripts\/toolbox-tracker\.mjs)/;
const RETIRED = [
  [/\bclient\.mutate\s*\(/, 'client.mutate (a starter writes with sql`…`)'],
  [/\b_sql\b/, '_sql (the page counts with sql`…`)'],
  [/\b\w+_aggregate\b/, '_aggregate roots (totals use SQL)'],
  [/extensions\?*\.outcomes/, 'GraphQL extensions.outcomes'],
  [/\btypeDefs\b/, 'typeDefs (no starter has server code)'],
  [/\/fn\/|resolverSources|af-resolver|tracker\.ts\b/, 'a page function (no starter has server code: its dataset rules decide)'],
];

/** Each way SOURCE (a gate or gate fixture) reaches a starter that the skill no longer ships; [] when it uses none. */
function retiredStarterUses(source) {
  if (!USES_STARTER.test(source)) return [];
  return RETIRED.filter(([re]) => re.test(source)).map(([, what]) => what);
}

const specs = ['scripts/gates', 'scripts/gates/lib', 'scripts/fixtures'].flatMap((dir) =>
  readdirSync(path.join(ROOT, dir), { withFileTypes: true }).filter((e) => e.isFile() && /\.m?js$/.test(e.name)).map((e) => `${dir}/${e.name}`));

describe('gates reach skill starters only through the API the starters ship', () => {
  it('finds the gates that use a starter (the scan is not vacuous)', () => {
    const using = specs.filter((file) => USES_STARTER.test(readFileSync(path.join(ROOT, file), 'utf8')));
    expect(using).toEqual(expect.arrayContaining(['scripts/gates/gate-live-cells.mjs']));
  });

  it.each(specs)('%s uses no retired starter API', (file) => {
    expect(retiredStarterUses(readFileSync(path.join(ROOT, file), 'utf8'))).toEqual([]);
  });

  it('refuses a starter reached through a page function, GraphQL or _sql', () => {
    const tracker = "import { trackerFiles } from '../../services/app/skills/artifactbin/scripts/toolbox-tracker.mjs';\n";
    expect(retiredStarterUses(`${tracker}await fetch(\`\${BASE}/api/artifacts/\${id}/fn/add\`, { method: 'POST' });`)).toEqual([expect.stringContaining('page function')]);
    expect(retiredStarterUses(`${tracker}check(text === '3 of 3', 'the page counts the group with _sql');`)).toEqual([expect.stringContaining('_sql')]);
    expect(retiredStarterUses(`${tracker}const r=await client.mutate({mutation:gql\`mutation{x}\`});r.extensions?.outcomes;`)).toHaveLength(2);
    // The current flow passes, and a gate with no starter may keep covering the legacy GraphQL door.
    expect(retiredStarterUses(`${tracker}await api(\`/api/artifacts/\${id}/sql\`, { method: 'POST' });`)).toEqual([]);
    expect(retiredStarterUses("const r=await client.mutate({mutation:gql`mutation{insert_sales_one(object:{amount:9}){_id}}`});")).toEqual([]);
  });
});
