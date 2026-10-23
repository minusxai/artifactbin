import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import type {BackendSecretScope,BackendSecretCipher} from './contracts';
export function createBackendSecretCipher(secret:string):BackendSecretCipher{
const key=()=>createHash('sha256').update('artifactbin/backend-secret/v1\0'+secret).digest();
const aad=(scope:BackendSecretScope,name:string)=>Buffer.from(JSON.stringify([scope.ownerId,scope.backendId,name]));
return {
 seal(value,scope,name){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);cipher.setAAD(aad(scope,name));return Buffer.concat([iv,cipher.update(value,'utf8'),cipher.final(),cipher.getAuthTag()]).toString('base64');},
 open(value,scope,name){const bytes=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',key(),bytes.subarray(0,12));cipher.setAAD(aad(scope,name));cipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([cipher.update(bytes.subarray(12,-16)),cipher.final()]).toString('utf8');},
};
}
