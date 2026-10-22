import type { AttachmentPort } from "./dataset-attachment-bridge-contracts.ts";
/** Implemented only in the trusted shell or credential service frame. */
export interface AttachmentHTTPOptions {
  origin: string;
  pageId(): string | null;
  authority(): string | null;
  headers(): Record<string,string>;
  fetch(url: string, init: RequestInit): Promise<Response>;
}
export type CreateAttachmentHTTP = (options: AttachmentHTTPOptions) => AttachmentPort;
