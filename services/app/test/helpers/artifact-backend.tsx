/**
 * The surface's components read their ArtifactBackend from context
 * (lib/artifact-backend/context). Tests that drive the real HTTP requests
 * through a stubbed `fetch` wrap in `withHttpBackend`; tests about a backend
 * that cannot do something use `fakeBackend` and say which features it lacks.
 */
import type { ReactElement, ReactNode } from 'react';
import { vi } from 'vitest';
import { ArtifactBackendProvider } from '@/lib/artifact-backend/context';
import { createHttpBackend } from '@/lib/artifact-backend/http';
import type { ArtifactBackend, BackendFeature } from '@/lib/artifact-backend/types';

const backends = new Map<string, ArtifactBackend>();
/** One backend per id for the whole file, as the page memoises it: a rerender must not re-subscribe. */
export const httpBackend = (id: string): ArtifactBackend => {
  let backend = backends.get(id);
  if (!backend) backends.set(id, backend = createHttpBackend(id));
  return backend;
};

export function withHttpBackend(id: string, ui: ReactElement): ReactElement {
  return <ArtifactBackendProvider backend={httpBackend(id)}>{ui}</ArtifactBackendProvider>;
}

/** The same, as a Testing Library `wrapper` (kept across `rerender`). */
export const httpBackendWrapper = (id: string) => function HttpBackendWrapper({ children }: { children: ReactNode }) {
  return <ArtifactBackendProvider backend={httpBackend(id)}>{children}</ArtifactBackendProvider>;
};

/**
 * A backend whose missing features answer with a reason. Every request is a
 * spy that resolves to an empty answer unless the test overrides it.
 */
export function fakeBackend(
  missing: Partial<Record<BackendFeature, string>> = {},
  overrides: Partial<ArtifactBackend> = {},
): ArtifactBackend {
  return {
    mode: Object.keys(missing).length ? 'offline' : 'online',
    unavailable: (feature) => missing[feature] ?? null,
    load: vi.fn(async () => null),
    commitEdit: vi.fn(async () => ({ ok: false, status: 503, body: {} as never })),
    prepare: vi.fn(async () => ({})),
    previewCss: vi.fn(async () => { throw new Error('no stylesheet'); }),
    previewQueries: vi.fn(async () => null),
    queryTable: vi.fn(async () => ({})),
    importImage: vi.fn(async () => ({ ok: false as const, error: 'unavailable' })),
    versions: vi.fn(async () => []),
    version: vi.fn(async () => null),
    revert: vi.fn(async () => ({ ok: false, status: 503, body: {} as never })),
    live: vi.fn(() => () => {}),
    liveFrame: vi.fn(async () => null),
    queryTransport: vi.fn(() => ({ run: async () => ({ tables: {}, errors: {} }), page: async () => { throw new Error('no rows'); }, dispose: () => {} })),
    listAnnotations: vi.fn(async () => []),
    createAnnotation: vi.fn(async () => { throw new Error('not stubbed'); }),
    actOnAnnotation: vi.fn(async () => { throw new Error('not stubbed'); }),
    deleteAnnotation: vi.fn(async () => {}),
    uploadCommentImage: vi.fn(async () => ({ id: 'img' })),
    members: vi.fn(async () => ({ people: [], mentions: {} })),
    remoteSessions: vi.fn(async () => ({ sessions: [] })),
    deleteRemoteSession: vi.fn(async () => {}),
    ...overrides,
  };
}
