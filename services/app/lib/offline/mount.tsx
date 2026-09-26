/**
 * Mounts the offline file's page into its own shell (lib/offline/file-html):
 * reads `#afbin-file`, validates it, and renders OfflineApp in place of the
 * "Opening …" placeholder — or, for a file that cannot be read, the
 * reader-facing ArtifactFileError message in the same place.
 *
 * Separate from lib/offline/entry.tsx, which only wires the bundle's globals
 * and calls this, so the mount is testable without the bundle.
 */
import { createRoot, type Root } from 'react-dom/client';
import { OfflineApp, OfflineFileError } from '@/components/offline/OfflineApp';
import { ArtifactFileError, type ArtifactFile } from './file-format';
import { ARTIFACT_FILE_IDS, readArtifactFileParts } from './file-html';

const UNREADABLE = 'This file could not be opened.';

export function mountOfflineFile(doc: Document, onFile?: (file: ArtifactFile) => void): Root | null {
  const container = doc.getElementById(ARTIFACT_FILE_IDS.root);
  if (!container) return null;
  const root = createRoot(container);
  try {
    const { file, code } = readArtifactFileParts(doc);
    onFile?.(file);
    root.render(<OfflineApp file={file} code={code} />);
  } catch (error) {
    root.render(<OfflineFileError message={error instanceof ArtifactFileError ? error.message : UNREADABLE} />);
  }
  return root;
}
