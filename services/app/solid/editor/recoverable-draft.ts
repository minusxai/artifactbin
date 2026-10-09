/** The portable copy used after a refused save. */
import { stringify } from 'yaml';

interface DraftMetadata {title:string|null;theme:string|null;template:string|null;colorMode:string|null}

/**
 * Preserve the current editable source and presentation metadata in a portable JSX document.
 * Deliberately excludes remote identity and sharing state: this is a recovery copy, not an export
 * of the artifact's authority or location.
 */
export function recoverableDraft(source: string, metadata: DraftMetadata): string {
  const header = stringify(metadata, { lineWidth: 0 }).trimEnd();
  return `---\n${header}\n---\n${source}`;
}
