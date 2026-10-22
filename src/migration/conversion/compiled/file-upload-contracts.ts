import type { AttachmentMime } from "../../../browser/dataset-attachment-bridge-contracts.ts";
/** Source grammar only. The trusted imported catalog must resolve bindingName separately. */
export interface LegacyFileUploadSite {
  bindingName: string;
  valueName: string;
  busyName?: string;
  disabledSignal?: string;
  multiple: boolean;
  maxFiles: number;
  acceptedTypes: readonly AttachmentMime[];
}
export type ReadLegacyFileUploadSites = (
  source: string,
  visit?: (node: unknown, site: LegacyFileUploadSite) => void,
) => readonly LegacyFileUploadSite[];
