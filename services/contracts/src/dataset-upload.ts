/** The durable attachment receipt shared by browser controls and CLI uploads. */
export interface DatasetUploadResult {
  ref: string;
  url: string;
  name: string;
  contentType: string;
  size: number;
  replayed?: boolean;
}
