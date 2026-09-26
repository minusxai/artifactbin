'use client';
/**
 * Where the surface's components find their ArtifactBackend. The page that
 * owns an artifact (components/ArtifactSurface, or the offline file) provides
 * one per artifact; every component under it reads it here.
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { ArtifactBackend } from './types';

const ArtifactBackendContext = createContext<ArtifactBackend | null>(null);

export function ArtifactBackendProvider({ backend, children }: { backend: ArtifactBackend; children: ReactNode }) {
  return <ArtifactBackendContext.Provider value={backend}>{children}</ArtifactBackendContext.Provider>;
}

/** The artifact's backend. Rendering outside a provider is a wiring mistake, and says so. */
export function useArtifactBackend(): ArtifactBackend {
  const backend = useContext(ArtifactBackendContext);
  if (!backend) {
    throw new Error(
      'useArtifactBackend() was called outside <ArtifactBackendProvider>. Wrap the surface in a provider '
      + '(components/ArtifactSurface.tsx provides createHttpBackend(id); the offline file provides its own).',
    );
  }
  return backend;
}

/**
 * For the one component that also renders where no surface exists (the
 * document runtime's mention statuses, e.g. a served document): null there.
 */
export function useOptionalArtifactBackend(): ArtifactBackend | null {
  return useContext(ArtifactBackendContext);
}
