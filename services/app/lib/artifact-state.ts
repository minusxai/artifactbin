import {createHash} from 'node:crypto';
import type {ArtifactRow} from './artifacts';

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered((value as Record<string,unknown>)[key])]));
  return value;
}

/** Opaque observation of authored content and metadata, excluding derived caches. */
export function artifactState(row: ArtifactRow): string {
  const {parsedArtifact: _parsed, compiledCss: _css, cssCompileVersion: _compiler, ...metadata} = row.meta;
  return createHash('sha256').update(JSON.stringify(ordered({
    id: row.id, version: row.version, edit_id: row.edit_id,
    title: row.title, description: row.description, format: row.format,
    source: row.source, content: row.content, visibility: row.visibility, access: row.access,
    link_role: row.link_role ?? 'viewer', ancestor_ids: row.ancestor_ids, metadata,
  }))).digest('hex');
}
