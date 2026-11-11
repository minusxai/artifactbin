/**
 * SECRETS AT REST: a stored secret (a connection's password, a key) sealed with AES-256-GCM under a key derived from
 * the host's secret (AUTH__SECRET) for this purpose alone. `context` is the secret's identity, bound into the
 * authentication tag (its owner, its record, its field name): a value sealed for one context never opens under
 * another, so a row cannot lend its secret to a different one. Fresh 96-bit nonce per seal; the output is base64
 * of nonce, ciphertext and tag. Opening a value under the wrong key or context throws. Never log either side.
 */
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {AUTH_SECRET} from './config';

export interface SecretCipher {
  seal(value: string, context: readonly string[]): string;
  open(sealed: string, context: readonly string[]): string;
}
/** A cipher under `secret`; the key derivation label keeps it apart from every other use of that secret. */
export function createSecretCipher(secret: string): SecretCipher {
  const key = () => createHash('sha256').update('artifactbin/backend-secret/v1\0' + secret).digest();
  const aad = (context: readonly string[]) => Buffer.from(JSON.stringify(context));
  return {
    seal(value, context) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
      cipher.setAAD(aad(context));
      return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64');
    },
    open(sealed, context) {
      const bytes = Buffer.from(sealed, 'base64'), cipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12));
      cipher.setAAD(aad(context));
      cipher.setAuthTag(bytes.subarray(-16));
      return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString('utf8');
    },
  };
}
/** This host's cipher (AUTH__SECRET), created on first use. */
let hostCipher: SecretCipher | undefined;
export const secretCipher = (): SecretCipher => (hostCipher ??= createSecretCipher(AUTH_SECRET));
