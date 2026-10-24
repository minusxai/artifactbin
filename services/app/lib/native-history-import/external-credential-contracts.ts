import type {Queryable} from '@artifactbin/contracts';
import type {NativeCatalogDataset} from './catalog-contracts';
/** Digest of a private source encrypted row; never a password or authentication key. */
export interface NativeExternalConnectionReceipt {datasetSourceId:string;sourceSecretSha256:string}
export interface NativeExternalCredentialSource {
 /** Private source deployment key, held only by the host import process. */
 sourceAuthSecret:string;
 /** Canonical encrypted dataset_secrets row bytes, acquired read-only. */
 read(dataset:NativeCatalogDataset):Promise<Buffer>;
}
export interface NativeStagedExternalCredentials {
 apply(tx:Queryable):Promise<void>;
 verify(tx:Queryable):Promise<void>;
}
