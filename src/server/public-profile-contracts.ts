/**
 * Public metadata only; no account identifiers, email, memberships or private
 * files. The photo is the one public identity field the earlier product's
 * anonymous profile showed beside the handle: the account's own photo exactly
 * as the Account page stores it (a data:image/png|jpeg|webp;base64 URL of at
 * most 150,000 characters), or null. The display name is not public.
 */
export interface PublicProfilePage {
  handle: string;
  image: string | null;
  files: readonly { id: string; title: string }[];
  next: string | null;
}
export const PROFILE_IMAGE_PATTERN =
  /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
export const PROFILE_IMAGE_MAX_LENGTH = 150000;
export interface PublicProfileRepository {
  read(
    handle: string,
    after: string | null,
    limit: number,
  ): Promise<PublicProfilePage | null>;
}
export interface PublicProfileResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}
