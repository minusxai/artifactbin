import {randomBytes} from 'node:crypto';
import {datasetSecretTargetHash as targetHash,sealDatasetSecret,openDatasetSecret} from './secret-crypto';
import {AUTH_SECRET} from '@/lib/platform/config';
import {getDb} from '@/lib/platform/db';
import type {Queryable} from '@artifactbin/contracts';
import type { AccessActor, TokenHoldingActor } from '@/lib/accounts';
import type {DatasetConnection,PostgresConfig} from './types';
import {DatasetError} from './errors';

type Target=Omit<DatasetConnection,'passwordSecretId'>;
interface SecretRow{id:string;token_id:string;user_id:string|null;dataset_id:string|null;target_hash:string;ciphertext:string}
const seal=(value:string,id:string,hash:string)=>sealDatasetSecret(value,id,hash,AUTH_SECRET);
const open=(row:SecretRow)=>openDatasetSecret(row,AUTH_SECRET);
const owned=(actor:AccessActor)=>actor.userId?{sql:'(user_id=$3 OR token_id IN (SELECT id FROM tokens WHERE user_id=$3))',value:actor.userId}:{sql:'token_id=$3 AND user_id IS NULL',value:actor.tokenId};

/** Stamps `dataset_secrets.token_id` (NOT NULL): the creator must hold a token — a session's is its account token (`withAccountToken`). */
export async function createDatasetSecret(actor:TokenHoldingActor,value:string,target:Target,datasetId?:string):Promise<{id:string}>{
 if(typeof value!=='string'||!value.length||value.length>4096)throw new DatasetError('Secret value is required');
 const id='sec_'+randomBytes(12).toString('hex'),hash=targetHash(target),db=await getDb();
 await db.query('INSERT INTO dataset_secrets(id,token_id,user_id,dataset_id,target_hash,ciphertext) VALUES($1,$2,$3,$4,$5,$6)',[id,actor.tokenId,actor.userId,datasetId??null,hash,seal(value,id,hash)]);return {id};
}

/** Resolve only for an editor-bound dataset, or an actor-owned pending create secret. */
export async function resolveDatasetConnection(connection:DatasetConnection,actor?:AccessActor,datasetId?:string,db?:Queryable):Promise<PostgresConfig>{
 const target={host:connection.host,port:connection.port,database:connection.database,username:connection.username,ssl:connection.ssl},hash=targetHash(target),q=db??await getDb();let row:SecretRow|undefined;
 if(datasetId)row=(await q.query<SecretRow>('SELECT * FROM dataset_secrets WHERE id=$1 AND dataset_id=$2 AND target_hash=$3',[connection.passwordSecretId,datasetId,hash])).rows[0];
 else if(actor){const scope=owned(actor);row=(await q.query<SecretRow>(`SELECT * FROM dataset_secrets WHERE id=$1 AND target_hash=$2 AND dataset_id IS NULL AND ${scope.sql}`,[connection.passwordSecretId,hash,scope.value])).rows[0];}
 if(!row)throw new DatasetError('Dataset credentials are unavailable',403);
 try{return {...target,password:open(row)};}catch{throw new DatasetError('Dataset credentials are unavailable',503);}
}

export async function claimPendingDatasetSecret(connection:DatasetConnection,actor:AccessActor,datasetId:string,db:Queryable):Promise<void>{
 const hash=targetHash(connection),scope=owned(actor);const result=await db.query(`UPDATE dataset_secrets SET dataset_id=$2 WHERE id=$1 AND dataset_id IS NULL AND target_hash=$4 AND ${scope.sql} RETURNING id`,[connection.passwordSecretId,datasetId,scope.value,hash]);if(!result.rows[0])throw new DatasetError('Dataset credentials are unavailable',403);
}
