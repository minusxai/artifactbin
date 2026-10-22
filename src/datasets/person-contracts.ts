import type { DatasetCallContext, DatasetReadService } from "./contracts.ts";
export interface DatasetPersonCard {
  name: string;
  handle: string | null;
  image: string | null;
}
/** Trusted publication descriptor. Never accepted as runtime page input. */
export interface DatasetPersonBinding {
  sourceNamespace: string;
  backendId: string;
  backendVersion: string;
  pageId: string;
  pageVersion: number;
  valueName: string;
  bindingName: string;
  schema: string;
  table: string;
  column: string;
}
export interface DatasetPersonPorts {
  binding(
    context: DatasetCallContext,
    valueName: string,
  ): Promise<DatasetPersonBinding | null>;
  reads: DatasetReadService;
  card(
    sourceNamespace: string,
    legacyUserId: string,
  ): Promise<DatasetPersonCard | null>;
}
export interface DatasetPersonService {
  person(
    context: DatasetCallContext,
    input: unknown,
  ): Promise<DatasetPersonCard | null>;
}
