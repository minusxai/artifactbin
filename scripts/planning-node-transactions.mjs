// Disposable Postgres planning rehearsal. Only touches its dedicated container.
import { spawn, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const container = 'artifactbin-node-planning-pg';
const args = ['exec', '-i', container, 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'];
const sql = text => execFileSync('docker', args, {input: text, encoding: 'utf8'}).trim();
const run = text => new Promise((resolve, reject) => {
  const child = spawn('docker', args); let out = ''; let err = '';
  child.stdout.on('data', b => out += b); child.stderr.on('data', b => err += b);
  child.on('exit', code => code ? reject(new Error(err)) : resolve(out.trim()));
  child.stdin.end(text);
});
sql(`CREATE TABLE IF NOT EXISTS planning_doc (id int PRIMARY KEY, source text, version int);
CREATE TABLE IF NOT EXISTS planning_comments (node_id text);
CREATE TABLE IF NOT EXISTS planning_history (source text, version int);
TRUNCATE planning_doc, planning_comments, planning_history;
INSERT INTO planning_doc VALUES (1, '<p id="a001">hello</p>', 1);`);
async function waitForLockHolder(name) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${name}' AND wait_event='PgSleep'`) === '1') return;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error('lock holder did not reach barrier');
}
// Deletion owns the row first. Comment's locked read must see committed deletion.
const deletion = run(`SET application_name='planning_delete'; BEGIN; SELECT id FROM planning_doc WHERE id=1 FOR UPDATE;
UPDATE planning_doc SET source='', version=version+1 WHERE id=1; SELECT pg_sleep(1); COMMIT;`);
await waitForLockHolder('planning_delete');
const comment = run(`BEGIN; SELECT id FROM planning_doc WHERE id=1 FOR UPDATE;
INSERT INTO planning_comments SELECT 'a001' FROM planning_doc WHERE id=1 AND source LIKE '%id="a001"%'; COMMIT;`);
await Promise.all([deletion, comment]);
assert.equal(sql('SELECT count(*) FROM planning_comments'), '0');
console.log('PASS deletion-first: no relation inserted');
sql(`UPDATE planning_doc SET source='<p id="a001">hello</p>' WHERE id=1;`);
const firstComment = run(`SET application_name='planning_comment'; BEGIN; SELECT id FROM planning_doc WHERE id=1 FOR UPDATE;
INSERT INTO planning_comments VALUES ('a001'); SELECT pg_sleep(1); COMMIT;`);
await waitForLockHolder('planning_comment');
const secondDelete = run(`BEGIN; UPDATE planning_doc SET source='', version=version+1 WHERE id=1; COMMIT;`);
await Promise.all([firstComment, secondDelete]);
assert.equal(sql('SELECT count(*) FROM planning_comments'), '1');
assert.equal(sql("SELECT source='' FROM planning_doc WHERE id=1"), 't');
console.log('PASS comment-first: relation survives as orphan');
sql(`TRUNCATE planning_comments, planning_history;
UPDATE planning_doc SET source='<p id="intro" data-annotation-anchor="old">hello</p>', version=1;
INSERT INTO planning_comments VALUES ('old');`);
const migrate = crash => `BEGIN; SELECT id FROM planning_doc WHERE id=1 FOR UPDATE;
INSERT INTO planning_history SELECT source, version FROM planning_doc WHERE source LIKE '%data-annotation-anchor%';
UPDATE planning_doc SET source=replace(source, ' data-annotation-anchor="old"', ''), version=version+1 WHERE source LIKE '%data-annotation-anchor%';
${crash ? 'SELECT 1/0;' : ''}
UPDATE planning_comments SET node_id='intro' WHERE node_id='old'; COMMIT;`;
await assert.rejects(run(migrate(true)));
assert.equal(sql('SELECT version FROM planning_doc'), '1');
assert.equal(sql('SELECT count(*) FROM planning_history'), '0');
assert.equal(sql('SELECT node_id FROM planning_comments'), 'old');
await run(migrate(false)); await run(migrate(false));
assert.equal(sql('SELECT version FROM planning_doc'), '2');
assert.equal(sql('SELECT count(*) FROM planning_history'), '1');
assert.equal(sql('SELECT node_id FROM planning_comments'), 'intro');
console.log('PASS migration: source/relation/archive rollback together; resume is idempotent');
// Revert must normalize historical alias while keeping authored identity.
sql(`UPDATE planning_doc SET source=(SELECT replace(source, ' data-annotation-anchor="old"', '') FROM planning_history LIMIT 1), version=version+1;`);
assert.equal(sql(`SELECT source LIKE '%id="intro"%' FROM planning_doc`), 't');
assert.equal(sql('SELECT node_id FROM planning_comments'), 'intro');
console.log('PASS historical source rehearsal: normalized revert retains authored id and relation');
sql(`CREATE TABLE IF NOT EXISTS planning_reserved (artifact_id int, node_id text, PRIMARY KEY(artifact_id,node_id));
TRUNCATE planning_reserved;
INSERT INTO planning_reserved VALUES (1,'a001');`);
assert.equal(sql("INSERT INTO planning_reserved VALUES(1,'a001') ON CONFLICT DO NOTHING RETURNING node_id").includes('a001'), false);
assert.equal(sql("INSERT INTO planning_reserved VALUES(1,'a002') ON CONFLICT DO NOTHING RETURNING node_id").includes('a002'), true);
assert.equal(sql("INSERT INTO planning_reserved VALUES(2,'a001') ON CONFLICT DO NOTHING RETURNING node_id").includes('a001'), true);
console.log('PASS lifetime reservation: retired id rejected for same artifact, allowed in another');
console.log('LIMIT: prototype tables/SQL, not integrated artifact routes or deploy rollback');
