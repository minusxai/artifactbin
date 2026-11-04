import {createHash} from 'node:crypto';
import type { ArtifactRow } from '@/lib/artifact-access';

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered((value as Record<string,unknown>)[key])]));
  return value;
}

/**
 * Opaque observation of what a content or details write replaces: the version and edit identity, the source, title,
 * description, format and authored metadata (derived caches excluded). Access settings are NOT observed here — sharing,
 * visibility, link role and access move `sharing_revision`, a dataset policy moves `policy_revision`, and placement is
 * the owner's — so changing them never refuses a content write; writes OF them fence on their own revisions.
 */
export function artifactState(row: ArtifactRow): string {
  const {parsedArtifact: _parsed, compiledCss: _css, cssCompileVersion: _compiler, ...metadata} = row.meta;
  return createHash('sha256').update(JSON.stringify(ordered({
    id: row.id, version: row.version, edit_id: row.edit_id,
    title: row.title, description: row.description, format: row.format,
    source: row.source, metadata,
  }))).digest('hex');
}

/**
 * What moved under a conditional write: `content` when a newer version exists (or the caller named no version, so the
 * whole page must be re-read), `details` when the named version is still the head but its title, description or
 * metadata changed, `sharing`/`policy` when the observed revision of that access setting moved.
 */
export type ConflictChange = 'content' | 'details' | 'sharing' | 'policy';
/** The change an observed version and state no longer match, or null when both still name the head. */
export function observedChange(current: ArtifactRow, expected: {expectedVersion?: number; expectedState?: string}): ConflictChange | null {
  if (expected.expectedVersion !== undefined && expected.expectedVersion !== current.version) return 'content';
  if (expected.expectedState !== undefined && expected.expectedState !== artifactState(current)) return expected.expectedVersion === undefined ? 'content' : 'details';
  return null;
}

/** The one 409 body every artifact door answers for an observed-head miss. */
export function versionConflict(current: ArtifactRow, changed: ConflictChange) {
  return {error: 'version_conflict' as const, currentVersion: current.version, currentState: artifactState(current), changed};
}
