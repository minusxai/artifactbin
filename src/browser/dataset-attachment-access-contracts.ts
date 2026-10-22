import type { RemoteAccessSnapshot } from "../apollo/apollo-contracts.ts";
import type { AttachmentPort } from "./dataset-attachment-bridge-contracts.ts";
/** Internal compiled adapter capability on the imported client; not an author API. */
export const ATTACHMENT_ACCESS_KEY = "afbin.internal.datasetAttachment";
export const ATTACHMENT_ACCESS = Symbol.for(ATTACHMENT_ACCESS_KEY);
export interface InternalAttachmentClient {
  [ATTACHMENT_ACCESS](): AttachmentAccess;
}
export interface AttachmentAccess {
  transport(): AttachmentPort | null;
  authority(): { generation: string; allowed: boolean } | null;
  subscribe(changed: () => void): () => void;
}
export interface AttachmentAccessPorts {
  transport(): AttachmentPort | undefined;
  access(): RemoteAccessSnapshot | undefined;
  subscribe(changed: () => void): () => void;
}
