import type {
  Publication,
  PublicationOptions,
  PublishPairRequest,
  SharedFile,
} from "./contracts.ts";
export interface PreparedPublication {
  publication: Publication;
  file: SharedFile | null;
  created: boolean;
}
export interface PublicationPreparation {
  (
    existing: Publication | null,
    actor: string,
    request: PublishPairRequest,
    options: PublicationOptions,
  ): PreparedPublication;
}
