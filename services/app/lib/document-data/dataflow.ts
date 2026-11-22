import { type ArtifactRow, getArtifactFor, getLinkReadableArtifact } from '@/lib/artifacts';
import { writerFor } from '@/lib/artifact-access';

/** Resolve an admitted asset using the document owner's normal reference scope. */
export async function referencedArtifactForRow(row: ArtifactRow, id: string): Promise<ArtifactRow | null> {
  const refs = (row.meta as { refs?: Array<{ id: string }> }).refs ?? [];
  if (!refs.some((ref) => ref.id === id)) return null;
  return (await getArtifactFor(writerFor(row), id))
    ?? (await getLinkReadableArtifact(id));
}
