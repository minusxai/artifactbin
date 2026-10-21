/** Candidate format v2. Canonicalization is structural HTML, never live DOM. */
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export interface Envelope {
  format: 2;
  app: Json;
  comments: Json[];
}
export interface DecodedDocument {
  source: string;
  state: Envelope;
  revision: string;
}
export interface SourceCodec {
  decode(
    html: string,
    options?: { runtime?: string },
  ): Promise<DecodedDocument>;
  save(canonicalSource: string, state: Envelope): string;
}
