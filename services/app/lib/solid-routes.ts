import type { ArtifactRole } from './share-roles';

/**
 * The document shell changes only for view-only readers for now. The root gap, traced to source:
 * Document.tsx ADOPTS the compiled document's DOM but never mounts anything that establishes a
 * StoryController for it (React's IslandStory does that, via createFrameEditSession +
 * mountCompiledEditRegions, only when it is actively mounted). Without a controller,
 * lib/story-runtime/document-endpoint's `sendDocument`/`subscribeDocument` have nothing to
 * reach — so every capability gated on it is inert: the owner/editor managed iframe (CLI/agent
 * `window.mx` mutation), in-place editing, AND a commenter's own selection bubble ("select text to
 * comment" — solid/document/AnnotationLayer's `runtimeRef`/`sessionNonce` path). Browser gates
 * confirmed the owner/editor half (gate-managed-iframe, gate-testusers, gate-collab-edit,
 * gate-inplace-edit); gate-link-access's commenter selection-bubble step depends on the same
 * missing controller. Widen once a Solid controller-establishing mount exists.
 */
export function solidDocumentReader(role: ArtifactRole, format: string, capture: boolean): boolean {
  return !capture && format === 'markup' && role === 'viewer';
}

/** Candidate Solid routes. Admitted document roles select their idle entry at serve time. */
export function isSolidPage(pathname: string, status = 200, artifactFormat?: string): boolean {
  const idRoute = /^\/a\/[^/]+\/?$/.test(pathname);
  const aliasRoute = /^\/@[^/]+\/[^/]+\/?$/.test(pathname);
  if (status === 200 && artifactFormat && (idRoute || aliasRoute)) return idRoute && artifactFormat === 'folder';
  if (status === 200 && artifactFormat === 'dataset' && /^\/a\/[^/]+\/edit\/?$/.test(pathname)) return true;
  return status === 404 || ['/', '/assets', '/datasets/new', '/files/new', '/trash', '/chat', '/login', '/start', '/welcome', '/notifications', '/account', '/docs-human'].includes(pathname)
    || /^\/@[^/]+\/?$/.test(pathname)
    || /^\/a\/[^/]+\/?$/.test(pathname)
    || /^\/@[^/]+\/[^/]+\/?$/.test(pathname);
}
