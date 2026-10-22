import type {MigrationArchiveSource} from "./archive-contracts.ts";
import type {LegacyRow,SqlReader} from './contracts.ts';
import type {StreamArchiveDestination,StreamPart} from './stream-contracts.ts';
import {destinationSchemas} from './destination-schema.ts';
/** Migration-only storage. Runtime never queries or evaluates legacy records. */
export class PostgresStreamArchive implements StreamArchiveDestination {
 private db:SqlReader;private schema:string;private isolated:boolean;
 constructor(db:SqlReader,schema:string,isolated:boolean){this.schema=destinationSchemas(schema).archive;this.db=db;this.isolated=isolated;}
 async initialize():Promise<void>{
  if(!this.isolated)throw new Error('Explicit isolated destination required');
  await this.db.query(`CREATE SCHEMA IF NOT EXISTS ${this.schema}`);
  await this.db.query(`CREATE TABLE IF NOT EXISTS ${this.schema}.stream_parts(namespace text NOT NULL,path text NOT NULL,source_table text NOT NULL,digest text NOT NULL,rows bigint NOT NULL,bytes bigint NOT NULL,PRIMARY KEY(namespace,path))`);
  await this.db.query(`CREATE TABLE IF NOT EXISTS ${this.schema}.stream_rows(namespace text NOT NULL,path text NOT NULL,ordinal bigint NOT NULL,record jsonb NOT NULL,PRIMARY KEY(namespace,path,ordinal),FOREIGN KEY(namespace,path) REFERENCES ${this.schema}.stream_parts(namespace,path) DEFERRABLE INITIALLY DEFERRED)`);
 }
 async archiveManifest(source:MigrationArchiveSource):Promise<void>{
  if(!this.isolated)throw new Error('Explicit isolated destination required');
  await this.db.query(`CREATE TABLE IF NOT EXISTS ${this.schema}.stream_manifests(namespace text PRIMARY KEY,kind text NOT NULL,digest text NOT NULL,manifest jsonb NOT NULL)`);
  await this.db.query('BEGIN');try{
   await this.db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[source.namespace+':manifest']);
   const old=(await this.db.query(`SELECT kind,digest,manifest FROM ${this.schema}.stream_manifests WHERE namespace=$1`,[source.namespace])).rows[0];
   if(old){if(old.kind!==source.kind||old.digest!==source.manifestSha256)throw Error('Stream manifest receipt conflict');}
   else await this.db.query(`INSERT INTO ${this.schema}.stream_manifests VALUES($1,$2,$3,$4::jsonb)`,[source.namespace,source.kind,source.manifestSha256,JSON.stringify(source.originalManifest)]);
   await this.db.query('COMMIT');
  }catch(error){await this.db.query('ROLLBACK');throw error;}
 }
 async archivePart(namespace:string,part:StreamPart,rows:AsyncIterable<LegacyRow>):Promise<'created'|'unchanged'>{
  if(!this.isolated)throw new Error('Explicit isolated destination required');
  await this.db.query('BEGIN');try{
   await this.db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[namespace+':'+part.path]);
   const old=(await this.db.query(`SELECT digest,rows,bytes FROM ${this.schema}.stream_parts WHERE namespace=$1 AND path=$2`,[namespace,part.path])).rows[0];
   if(old){if(old.digest!==part.sha256||Number(old.rows)!==part.rows||Number(old.bytes)!==part.bytes)throw new Error('Stream archive receipt conflict');await this.db.query('COMMIT');return 'unchanged';}
   let ordinal=0;for await(const row of rows)await this.db.query(`INSERT INTO ${this.schema}.stream_rows VALUES($1,$2,$3,$4::jsonb)`,[namespace,part.path,ordinal++,JSON.stringify(row)]);
   if(ordinal!==part.rows)throw new Error('Stream archive row count mismatch');
   await this.db.query(`INSERT INTO ${this.schema}.stream_parts VALUES($1,$2,$3,$4,$5,$6)`,[namespace,part.path,part.table,part.sha256,part.rows,part.bytes]);await this.db.query('COMMIT');return 'created';
  }catch(error){await this.db.query('ROLLBACK');throw error;}
 }
}
