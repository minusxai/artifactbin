import type { ImageProcessor } from "../datasets/attachments/image-processor-contracts.ts";
export interface DatasetAttachmentStorageOptions {
  directory: string;
  processor: ImageProcessor;
}
