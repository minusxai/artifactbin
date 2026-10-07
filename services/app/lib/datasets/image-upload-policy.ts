import type {DatasetGrantPolicy,DatasetGrantContext} from '@artifactbin/contracts';
import { datasetGrantAllows } from '@artifactbin/utils';
export function imageInsertAllowed(policy:DatasetGrantPolicy|null,context:DatasetGrantContext):boolean {
  return !!policy && datasetGrantAllows(policy,'insert',context);
}
