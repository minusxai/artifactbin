import type {
  DatasetAttachmentContext,
  DatasetAttachmentService,
} from "../datasets/attachments/contracts.ts";
export interface DatasetAttachmentHttpPorts {
  service: DatasetAttachmentService;
  /** Captures the fresh authenticated subject and current backend tuple; no page-supplied actor/backend ID. */
  resolve(
    input: {
      pageId: string;
      backendNamespace: string;
      bindingName: string;
      credential: string;
    },
    signal: AbortSignal,
  ): Promise<DatasetAttachmentContext | null>;
}
