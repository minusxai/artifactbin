/**
 * What a write STORED, read the way an agent now reads it.
 *
 * A write echoes `markup` only when storing changed it (`markup_changed`); a
 * false there means the stored document is byte-for-byte what the caller sent,
 * so the caller already has it. Tests that assert stored content do exactly
 * what an agent does — take the echo when it came, else keep what they sent.
 */
export function storedMarkup(wire: { markup?: string | null; markup_changed?: boolean }, sent: string): string {
  return wire.markup ?? sent;
}
