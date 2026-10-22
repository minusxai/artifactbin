import type {
  MediaAddress,
  MediaRequest,
  MediaResponse,
} from "../media/contracts.ts";

/** Only these old document addresses retain a supported current meaning. */
export type LegacyAddress = {
  readonly id: string;
  readonly kind: "hosted" | "download" | "raw";
};
export type LegacyRawSource =
  | { readonly kind: "document"; readonly source: string }
  | { readonly kind: "media"; readonly address: MediaAddress };
export interface LegacyRawRepository {
  /** Fresh current-page permission; exact saved revision, or null. Never fallback to head. */
  read(
    id: string,
    credential: string,
    version?: number,
  ): Promise<LegacyRawSource | null>;
}
export interface LegacyAddressPorts {
  readonly raw: LegacyRawRepository;
  readonly media: { read(request: MediaRequest): Promise<MediaResponse> };
}
