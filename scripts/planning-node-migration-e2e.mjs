/** Destructive fixtures ONLY in the explicitly named disposable planning database. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {startDocument} from './lib/start-doc.mjs';
import {runMigrationCli} from './node-identity-migrate.mjs';

const base='http://localhost:5220';
const database='node_identity_e2e_20260905';
const sql=query=>execFileSync('docker',['exec','-i','artifactbin-node-planning-pg','psql','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-At'],{input:query,encoding:'utf8'}).trim();
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
assert.equal(sql('SELECT count(*) FROM node_identity_migration_jobs;'),'0','use a fresh dedicated rehearsal database; never reset a migration cursor');
const doc=await startDocument(base);
const id=quote(doc.id);
const legacy='<main id="root"><p id="intro" data-annotation-anchor="old">Legacy</p></main>';
sql(`BEGIN;
 UPDATE artifacts SET source=${quote(legacy)},version=2 WHERE id=${id};
 INSERT INTO artifact_versions(artifact_id,version,format,content,source,meta)
 VALUES(${id},1,'markup','','<p id="historical">Archive</p>','{}');
 INSERT INTO annotations(id,artifact_id,body,author_kind,status,anchor_key,snippet)
 VALUES('ann_rehearsal',${id},'Check legacy','human','open','old','');
 COMMIT;`);
const snapshot=()=>sql(`SELECT row_to_json(a) FROM (SELECT source,version,edit_id FROM artifacts WHERE id=${id}) a;`);
const before=snapshot();
const options={url:base,secret:process.env.ADMIN__SECRET,retries:0,batchSize:100,historyLimit:1000};
assert(options.secret,'ADMIN__SECRET required');
assert((await runMigrationCli({...options,dryRun:true})).ok);
assert.equal(snapshot(),before,'dry run cannot edit source/version');
assert.equal(sql('SELECT count(*) FROM node_identity_migration_jobs;'),'0');
assert((await runMigrationCli({...options,dryRun:false,batchSize:2})).ok);
const head=JSON.parse(snapshot());
assert.equal(head.version,3);
assert.equal(head.source,'<main id="root"><p id="intro">Legacy</p></main>');
assert.equal(sql("SELECT anchor_key FROM annotations WHERE id='ann_rehearsal';"),'intro');
assert.equal(sql(`SELECT source_id FROM artifact_node_aliases WHERE artifact_id=${id} AND legacy_key='old';`),'intro');
assert.equal(sql(`SELECT count(*) FROM artifact_source_ids WHERE artifact_id=${id} AND source_id IN ('root','intro','historical');`),'3');
assert.equal(sql(`SELECT source FROM artifact_versions WHERE artifact_id=${id} AND version=2;`),legacy);
assert.equal(sql(`SELECT source FROM artifact_versions WHERE artifact_id=${id} AND version=1;`),'<p id="historical">Archive</p>');
const after=snapshot();
const repeated=await runMigrationCli({...options,dryRun:false});
assert(repeated.ok);assert.equal(repeated.report.processed,0);assert.equal(snapshot(),after);
console.log(`PASS: real PostgreSQL dry run, bounded cursor resume, source/relations/aliases/history/reservations, idempotence (${doc.id})`);
