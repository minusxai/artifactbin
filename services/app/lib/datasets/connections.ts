import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {z} from 'zod';
import type { TokenActor } from '@/lib/artifacts';
import {AUTH_SECRET} from '@/lib/config';
import {getDb} from '@/lib/db';
import type { ConnectionSummary, PostgresConfig } from './types';

export class DatasetError extends Error {
  constructor(message:string,public status=400){super(message);}
}
const configShape=z.object({
  name:z.string().trim().min(1).max(120),
  host:z.string().trim().min(1).max(253).regex(/^[a-zA-Z0-9.:[\]-]+$/),
  port:z.number().int().min(1).max(65535).default(5432),
  database:z.string().min(1).max(128),username:z.string().min(1).max(128),
  password:z.string().max(4096).default(''),ssl:z.boolean().default(true),
}).strict();
const key=()=>createHash('sha256').update('artifactbin/dataset-connections/v1\0'+AUTH_SECRET).digest();
function seal(config:PostgresConfig,id:string):string {
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);cipher.setAAD(Buffer.from(id));
 return Buffer.concat([iv,cipher.update(JSON.stringify(config),'utf8'),cipher.final(),cipher.getAuthTag()]).toString('base64');
}
function open(ciphertext:string,id:string):PostgresConfig {
 const bytes=Buffer.from(ciphertext,'base64');const decipher=createDecipheriv('aes-256-gcm',key(),bytes.subarray(0,12));
 decipher.setAAD(Buffer.from(id));decipher.setAuthTag(bytes.subarray(-16));
 return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString('utf8'));
}
interface ConnectionRow {id:string;name:string;token_id:string;user_id:string|null;config:string}
const scope=(actor:TokenActor)=>actor.userId?{where:'user_id=$2',value:actor.userId}:{where:'token_id=$2 AND user_id IS NULL',value:actor.tokenId};
function publicRow(row:ConnectionRow):ConnectionSummary {
 const {password:_,...safe}=open(row.config,row.id);return {id:row.id,name:row.name,...safe};
}
export async function saveConnection(actor:TokenActor,input:unknown,id?:string):Promise<ConnectionSummary> {
 const parsed=configShape.safeParse(input);if(!parsed.success)throw new DatasetError('Invalid connection fields. Check the host, port and required fields.');
 const db=await getDb(),s=scope(actor);let old:ConnectionRow|undefined;
 if(id){old=(await db.query<ConnectionRow>(`SELECT * FROM dataset_connections WHERE id=$1 AND ${s.where}`,[id,s.value])).rows[0];if(!old)throw new DatasetError('Connection not found',404);}
 const {name,...config}=parsed.data;
 if(old&&!config.password)config.password=open(old.config,old.id).password;
 const cid=id??'conn_'+randomBytes(12).toString('hex');
 const rows=old?await db.query<ConnectionRow>(`UPDATE dataset_connections SET name=$3,config=$4,updated_at=now() WHERE id=$1 AND ${s.where} RETURNING *`,[cid,s.value,name,seal(config,cid)])
 :await db.query<ConnectionRow>('INSERT INTO dataset_connections (id,token_id,user_id,name,config) VALUES ($1,$2,$3,$4,$5) RETURNING *',[cid,actor.tokenId,actor.userId,name,seal(config,cid)]);
 if(!rows.rows[0])throw new DatasetError('Connection not found',404);
 return publicRow(rows.rows[0]);
}
export async function listConnections(actor:TokenActor):Promise<ConnectionSummary[]> {
 const db=await getDb();const s=scope(actor);
 return (await db.query<ConnectionRow>(`SELECT * FROM dataset_connections WHERE ${s.where.replace('$2','$1')} ORDER BY updated_at DESC`,[s.value])).rows.map(publicRow);
}
/** Omitting actor is only for execution of an already-authorized dataset catalog. */
export async function connectionConfig(id:string,actor?:TokenActor):Promise<PostgresConfig> {
 const db=await getDb();const s=actor?scope(actor):null;
 const row=(await db.query<ConnectionRow>(`SELECT * FROM dataset_connections WHERE id=$1${s?' AND '+s.where:''}`,s?[id,s.value]:[id])).rows[0];
 if(!row)throw new DatasetError('Connection not found',404);
 try{return open(row.config,id);}catch{throw new DatasetError('Connection credentials are unavailable. Re-enter the connection credentials.',503);}
}
