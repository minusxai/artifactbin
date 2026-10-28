import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import type {DatasetConnection} from './types';
export type DatasetSecretTarget=Omit<DatasetConnection,'passwordSecretId'>;
export const datasetSecretTargetHash=(target:DatasetSecretTarget)=>createHash('sha256').update(JSON.stringify({host:target.host,port:target.port,database:target.database,username:target.username,ssl:target.ssl})).digest('hex');
const key=(authSecret:string)=>createHash('sha256').update('artifactbin/dataset-secret/v1\0'+authSecret).digest();
export function sealDatasetSecret(value:string,id:string,hash:string,authSecret:string):string {
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(authSecret),iv);cipher.setAAD(Buffer.from(`${id}\0${hash}`));return Buffer.concat([iv,cipher.update(value,'utf8'),cipher.final(),cipher.getAuthTag()]).toString('base64');
}
export function openDatasetSecret(row:{id:string;target_hash:string;ciphertext:string},authSecret:string):string {
 const bytes=Buffer.from(row.ciphertext,'base64'),decipher=createDecipheriv('aes-256-gcm',key(authSecret),bytes.subarray(0,12));decipher.setAAD(Buffer.from(`${row.id}\0${row.target_hash}`));decipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString('utf8');
}
