import {datasetSecretTargetHash,type DatasetSecretTarget} from './secret-crypto';
/** Server configuration approves a complete reviewed connection tuple, never a caller-selected hostname alone. */
export function approvedDatasetPrivateTarget(target:DatasetSecretTarget,approved:readonly string[]):boolean {
 return approved.includes(datasetSecretTargetHash(target));
}
