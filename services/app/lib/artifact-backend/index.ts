/**
 * The artifact-backend module's interface: the app's HTTP backend for a document, its refusals, and the browser's
 * artifact write. Two transports stay leaves of their own: `reader-http` (the reader's anonymous read and live
 * stream, which the document page's eager graph carries without the rest) and `region-http` (a region's Yjs session,
 * only in the lazy edit chunks).
 */
export { BackendRequestError } from './errors';
export { artifactRequests, createHttpBackend } from './http';
export { writeBrowserArtifact } from './browser-artifact-write';
export type { AnnotationActionBody, ArtifactBackend, ArtifactHead, BackendFeature, ImageChoice, MemberPerson, ReaderArtifactBackend } from './types';
