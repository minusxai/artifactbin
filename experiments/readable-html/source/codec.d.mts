import type { DecodedDocument, Envelope } from "./contracts.ts";
export function decode(
  html: string,
  options?: { runtime?: string },
): Promise<DecodedDocument>;
export function save(source: string, state: Envelope): string;
