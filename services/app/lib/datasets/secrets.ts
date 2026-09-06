import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {AUTH_SECRET} from '@/lib/config';
import {getDb,type Queryable} from '@/lib/db';
import {getArtifactFor,type TokenActor} from '@/lib/artifacts';
import type {DatasetConnection,PostgresConfig} from './types';
import {DatasetError} from './errors';

type Target=Omit<DatasetConnection,'passwordSecretId'>;
interface SecretRow{id:string;token_id:string;user_id:string|null;dataset_id:string|null;target_hash:string;ciphertext:string}
const targetJson=(target:Target)=>JSON.stringify({host:target.host,port:target.port,database:target.database,username:target.username,ssl:target.ssl});
const targetHash=(target:Target)=>createHash('sha256').update(targetJson(target)).digest('hex');
const key=()=>createHash('sha256').update('artifactbin/dataset-secret/v1\0'+AUTH_SECRET).digest();
const seal=(value:string,id:string,hash:string)=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);cipher.setAAD(Buffer.from(`${id}\0${hash}`));return Buffer.concat([iv,cipher.update(value,'utf8'),cipher.final(),cipher.getAuthTag()]).toString('base64');};
const open=(row:SecretRow)=>{const bytes=Buffer.from(row.ciphertext,'base64'),decipher=createDecipheriv('aes-256-gcm',key(),bytes.subarray(0,12));decipher.setAAD(Buffer.from(`${row.id}\0${row.target_hash}`));decipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString('utf8');};
const owned=(actor:TokenActor)=>actor.userId?{sql:'(user_id=$3 OR token_id IN (SELECT id FROM tokens WHERE user_id=$3))',value:actor.userId}:{sql:'token_id=$3 AND user_id IS NULL',value:actor.tokenId};

export async function createDatasetSecret(actor:TokenActor,value:string,target:Target,datasetId?:string):Promise<{id:string}>{
 if(typeof value!=='string'||!value.length||value.length>4096)throw new DatasetError('Secret value is required');
 if(datasetId){const dataset=await getArtifactFor(actor,datasetId);if(!dataset||dataset.format!=='dataset')throw new DatasetError('Dataset not found',404);}
 const id='sec_'+randomBytes(12).toString('hex'),hash=targetHash(target),db=await getDb();
 await db.query('INSERT INTO dataset_secrets(id,token_id,user_id,dataset_id,target_hash,ciphertext) VALUES($1,$2,$3,$4,$5,$6)',[id,actor.tokenId,actor.userId,datasetId??null,hash,seal(value,id,hash)]);return {id};
}

/** Resolve only for an editor-bound dataset, or an actor-owned pending create secret. */
export async function resolveDatasetConnection(connection:DatasetConnection,actor?:TokenActor,datasetId?:string,db?:Queryable):Promise<PostgresConfig>{
 const target={host:connection.host,port:connection.port,database:connection.database,username:connection.username,ssl:connection.ssl},hash=targetHash(target),q=db??await getDb();let row:SecretRow|undefined;
 if(datasetId)row=(await q.query<SecretRow>('SELECT * FROM dataset_secrets WHERE id=$1 AND dataset_id=$2 AND target_hash=$3',[connection.passwordSecretId,datasetId,hash])).rows[0];
 else if(actor){const scope=owned(actor);row=(await q.query<SecretRow>(`SELECT * FROM dataset_secrets WHERE id=$1 AND target_hash=$2 AND dataset_id IS NULL AND ${scope.sql}`,[connection.passwordSecretId,hash,scope.value])).rows[0];}
 if(!row)throw new DatasetError('Dataset credentials are unavailable',403);
 try{return {...target,password:open(row)};}catch{throw new DatasetError('Dataset credentials are unavailable',503);}
}

export async function claimPendingDatasetSecret(connection:DatasetConnection,actor:TokenActor,datasetId:string,db:Queryable):Promise<void>{
 const hash=targetHash(connection),scope=owned(actor);const result=await db.query(`UPDATE dataset_secrets SET dataset_id=$2 WHERE id=$1 AND dataset_id IS NULL AND target_hash=$4 AND ${scope.sql} RETURNING id`,[connection.passwordSecretId,datasetId,scope.value,hash]);if(!result.rows[0])throw new DatasetError('Dataset credentials are unavailable',403);
}
