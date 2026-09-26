/**
 * PUBLISH A PERSON'S CONVERSION of a document the SQLite data-syntax migration
 * left as a conflict, through the same write path the migration uses:
 *
 *   npx tsx scripts/migrate/sqlite/apply-hand-conversion.ts --db <database url> (--objects <dir> | --live-objects) --artifact <id> --source <file.jsx>
 *
 * From the repository root. The new version is written like the migration's
 * own (no actor, the served theme), and the publish door checks it like any
 * other write. A document already in the current data syntax is refused: a
 * conversion must never apply twice.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { useLocalServices } from './local-services';

async function main() {
  const { values } = parseArgs({ options: {
    db: { type: 'string' }, objects: { type: 'string' }, 'live-objects': { type: 'boolean' }, artifact: { type: 'string' }, source: { type: 'string' },
  } });
  if (!values.db || !(values.objects || values['live-objects']) || !values.artifact || !values.source) {
    throw new Error('usage: apply-hand-conversion.ts --db <url> (--objects <dir> | --live-objects) --artifact <id> --source <file.jsx>');
  }
  await useLocalServices({ db: values.db, objects: values.objects, liveObjects: !!values['live-objects'] });
  // After the environment is set: lib/config reads it on first import.
  const [{ getDb }, artifacts, { artifactQuery }, { hasCurrentDataSyntax }, { servedDesign }] = await Promise.all([
    import('@/lib/db'), import('@/lib/artifacts'), import('@/lib/artifact-document'), import('@/lib/story/data-syntax'), import('@/lib/sqlite-syntax-migration'),
  ]);
  const db = await getDb();
  try {
    const current = await artifacts.getArtifactById(values.artifact);
    if (!current || current.format !== 'markup') throw new Error(`${values.artifact} is not a live document`);
    if (hasCurrentDataSyntax(current.meta)) throw new Error(`${values.artifact} is already in the current data syntax`);
    // Prepared outside the transaction (the publish preparation reads refs on its
    // own connection), committed under the row lock only if nobody wrote meanwhile.
    const prepared = await artifacts.publishMarkupForArtifact(current, readFileSync(values.source, 'utf8'), servedDesign(current.meta));
    if (prepared instanceof Response) throw new Error(`${values.artifact} refused (${prepared.status}): ${await prepared.text()}`);
    const row = await db.transaction(async (tx) => {
      const locked = (await artifactQuery<typeof current>(tx, 'SELECT * FROM artifacts WHERE id=$1 FOR UPDATE', [current.id])).rows[0];
      if (!locked || locked.edit_id !== current.edit_id) throw new Error(`${values.artifact} changed while it was being prepared; run again`);
      const committed = await artifacts.commitNormalizedMarkup(tx, null, locked, prepared);
      await tx.query('UPDATE artifacts SET meta=meta||$2::jsonb WHERE id=$1', [committed.id, JSON.stringify({ dataSyntaxMigration: { job: 'hand-conversion', from: locked.version, version: committed.version } })]);
      return committed;
    });
    console.log(`${values.artifact} published as version ${row.version}`);
  } finally {
    await db.close();
  }
}

await main();
