/**
 * The comment layer's FIRST read of the open threads, issued by the page the
 * moment it mounts — never after the layer's code has downloaded.
 *
 * The layer (components/AnnotationLayer) is an on-demand chunk
 * (components/AnnotationLayerOnDemand), but its data is not: the read that
 * seeds the marks must leave exactly when it did when the layer was part of
 * the page, so a commenter sees the marks no later than before. One read per
 * mount, whoever asks first — the page's mount effect or the layer's own —
 * and the layer consumes it instead of issuing a second.
 */
import type { AnnotationWire } from '@/lib/annotations';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';

export interface AnnotationSeed {
  /** The backend the read was made through; a layer on another backend reads for itself. */
  readonly backend: ArtifactBackend;
  /** The read, started on first call. */
  take(): Promise<AnnotationWire[]>;
}

export function annotationSeed(backend: ArtifactBackend): AnnotationSeed & { abort(): void } {
  let controller = new AbortController();
  let read: Promise<AnnotationWire[]> | undefined;
  const take = () => {
    if (!read) {
      read = backend.listAnnotations(undefined, { signal: controller.signal });
      read.catch(() => {}); // a consumer reports; an unconsumed failure is not unhandled
    }
    return read;
  };
  // Aborting forgets the read, so a remount (StrictMode's replay) reads afresh.
  return { backend, take, abort: () => { controller.abort(); controller = new AbortController(); read = undefined; } };
}
