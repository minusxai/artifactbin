// Planning transaction prototype: real PGlite, separate tables, no production mutation.
import { PGlite } from '@electric-sql/pglite';
import { randomUUID, createHash } from 'node:crypto';
const canonical = value => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const wire = row => ({ id: row.id, ...row.body, version: row.version, state: hash({ body: row.body, version: row.version }) });
export class Ledger {
  constructor(path) {
    this.db = new PGlite(path);
    this.ready = this.db.exec(`CREATE TABLE IF NOT EXISTS probe_artifacts (id text primary key, owner text not null, body jsonb not null, version int not null default 1, deleted boolean not null default false);
      CREATE TABLE IF NOT EXISTS probe_keys (owner text not null, key text not null, fingerprint text not null, id text not null, PRIMARY KEY(owner,key));`);
  }
  async close() { await this.db.close(); }
  async count() { return Number((await this.db.query('SELECT count(*) n FROM probe_artifacts')).rows[0].n); }
  async get(owner,id) {
    const row=(await this.db.query('SELECT * FROM probe_artifacts WHERE owner=$1 AND id=$2 AND NOT deleted',[owner,id])).rows[0];
    if(!row)throw Error('not_found');return wire(row);
  }
  async create(owner,key,body,fault) {
    const fingerprint=hash(body);
    const result=await this.db.transaction(async tx => {
      const existing=(await tx.query('SELECT * FROM probe_keys WHERE owner=$1 AND key=$2',[owner,key])).rows[0];
      if(existing){
        if(existing.fingerprint!==fingerprint)throw Error('key_payload_mismatch');
        const row=(await tx.query('SELECT * FROM probe_artifacts WHERE id=$1',[existing.id])).rows[0];
        if(row.deleted)throw Error('result_deleted');return wire(row);
      }
      const id=randomUUID();
      await tx.query('INSERT INTO probe_keys VALUES ($1,$2,$3,$4)',[owner,key,fingerprint,id]);
      if(fault==='reserved')throw Error('injected before commit');
      const row=(await tx.query('INSERT INTO probe_artifacts(id,owner,body) VALUES ($1,$2,$3) RETURNING *',[id,owner,JSON.stringify(body)])).rows[0];
      return wire(row);
    });
    if(fault==='committed')throw Error('injected lost response after commit');
    return result;
  }
  async update(owner,id,expected,patch) {
    return this.db.transaction(async tx => {
      const row=(await tx.query('SELECT * FROM probe_artifacts WHERE owner=$1 AND id=$2 AND NOT deleted FOR UPDATE',[owner,id])).rows[0];
      if(!row)throw Error('not_found');
      if(wire(row).state!==expected)throw Error('state_conflict');
      const body={...row.body,...patch}, version=row.version+(body.source!==row.body.source?1:0);
      return wire((await tx.query('UPDATE probe_artifacts SET body=$1,version=$2 WHERE id=$3 RETURNING *',[JSON.stringify(body),version,id])).rows[0]);
    });
  }
  async remove(owner,id){await this.db.query('UPDATE probe_artifacts SET deleted=true WHERE id=$1 AND owner=$2',[id,owner]);}
}
