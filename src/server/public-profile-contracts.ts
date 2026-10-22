/** Public metadata only; no account identifiers, email, memberships or private files. */
export interface PublicProfilePage {
  handle: string;
  files: readonly { id: string; title: string }[];
  next: string | null;
}
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
