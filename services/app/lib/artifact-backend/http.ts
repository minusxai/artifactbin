/**
 * THE ONLINE BACKEND — the surface's existing requests, moved here verbatim:
 * the same URLs (including where a call site did or did not encode the id),
 * methods, headers, credentials and failure semantics each call site had.
 *
 * Thin by design: one method per request. Composition (restoring a version,
 * preparing a document update) stays with its callers, so this module — which
 * the reader page and the document runtime reach statically — never pulls the
 * authoring pipeline into their bundles (lib/__tests__/reader-bundle-hygiene).
 *
 * `fetch` and `EventSource` are looked up at call time, never captured.
 */
import type { AnnotationWire } from '@/lib/annotations';
import { readAnnotationPages } from '@/lib/annotation-pages';
import { createAuthenticatedTransport } from '@/lib/story-runtime/authenticated-transport';
import { SIGN_IN_REQUIRED } from '@/lib/story/sign-in-required';
import type { ArtifactDataEvent, ArtifactLiveEvent, ArtifactVersionPing } from '@/lib/story/live';
import { STORY_ANNOTATIONS_EVENT, STORY_DATA_EVENT } from '@/lib/story-runtime/contract';
import { BackendRequestError } from './errors';
import type {
  ArtifactBackend,
  ArtifactHead,
  ArtifactVersionSnapshot,
  ArtifactVersionSummary,
  ChosenImage,
  DatasetTableRead,
  DraftQueryResult,
  EditAnswer,
  FlushResponse,
  ImageChoice,
  MembersAnswer,
  RemoteSessionsAnswer,
} from './types';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * The artifact's authoring requests as raw Responses, for callers whose
 * contract IS the Response (lib/browser-artifact-write: listings, folders and
 * the social preview read its status and body themselves).
 */
export function artifactRequests(id: string) {
  const path = `/api/my/artifacts/${encodeURIComponent(id)}`;
  return {
    head: () => fetch(path),
    version: (n: number) => fetch(`${path}/versions/${n}`),
    edits: (body: unknown) => fetch(`${path}/edits`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }),
    patch: (body: unknown) => fetch(path, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(body) }),
    revert: (body: unknown) => fetch(`${path}/revert`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }),
  };
}

/** The composer's refusal sentence: the door's error name, with its detail when it gave one. */
function annotationFailure(status: number, body: unknown): string {
  const fallback = `Could not save comment (${status})`;
  if (!body || typeof body !== 'object') return fallback;
  const { error, detail, details } = body as { error?: unknown; detail?: unknown; details?: unknown };
  const named = typeof error === 'string' ? error : fallback;
  const described = typeof detail === 'string'
    ? detail
    : Array.isArray(details) && typeof details[0]?.message === 'string'
      ? details[0].message
      : null;
  return described ? `${named}: ${described}` : named;
}

const answer = async (res: Response): Promise<EditAnswer> =>
  ({ ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as FlushResponse });

export function createHttpBackend(id: string): ArtifactBackend {
  const mine = `/api/my/artifacts/${id}`;
  const importImage = async (init: RequestInit, refusal: (res: Response) => Promise<string>, unreachable: string): Promise<ImageChoice> => {
    const res = await fetch('/api/my/artifacts?visibility=unlisted', { method: 'POST', ...init }).catch(() => null);
    if (!res) return { ok: false, error: unreachable };
    if (!res.ok) return { ok: false, error: await refusal(res) };
    return { ok: true, image: (await res.json()) as ChosenImage };
  };

  return {
    mode: 'online',
    unavailable: () => null,

    // ── the document ────────────────────────────────────────────────────────
    async load() {
      const res = await fetch(mine);
      return res.ok ? ((await res.json()) as ArtifactHead) : null;
    },
    async commitEdit(input) {
      return answer(await fetch(`${mine}/edits`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) }));
    },
    async prepare(source) {
      const response = await fetch(`/api/my/artifacts/${encodeURIComponent(id)}/prepare`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ source }) });
      if (response.ok) return response.json();
      const body = await response.json().catch(() => ({}));
      const message = body.details?.map((d: unknown) => typeof d === 'string' ? d : (d as { message?: string })?.message).filter(Boolean).join('\n');
      throw new Error(message || body.error || 'Unable to prepare document resources');
    },
    async previewCss(markup) {
      const res = await fetch('/api/preview', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ markup }) });
      if (!res.ok) throw new BackendRequestError('preview refused', res.status);
      const body = (await res.json()) as { css?: string | null };
      if (typeof body.css !== 'string') throw new BackendRequestError('no stylesheet', res.status);
      return { css: body.css };
    },
    async previewQueries(markup) {
      const r = await fetch('/api/query', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ markup }) });
      return r.ok ? ((await r.json()) as DraftQueryResult) : null;
    },
    async queryTable(ref, body) {
      const response = await fetch(`/a/${encodeURIComponent(ref)}/tables`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new BackendRequestError(data.details?.[0] ?? data.error ?? 'unavailable', response.status);
      return data as DatasetTableRead;
    },
    importImage(input) {
      /*
       * The URL door: the browser ingests-and-owns it (POST {imageUrl} — the
       * same lib/web-ingest path the agent door runs). Its refusal names the
       * URL and the reason, which is the point, so it is handed back as the
       * sentence to show.
       */
      if ('imageUrl' in input) {
        return importImage(
          { headers: JSON_HEADERS, body: JSON.stringify({ imageUrl: input.imageUrl }) },
          async (res) => {
            const body = (await res.json().catch(() => null)) as { error?: string; details?: string[] } | null;
            return body?.details?.[0] ?? (res.status === 403 ? 'You have reached your artifact limit.' : 'Could not import that image.');
          },
          'Import failed — check your connection and try again.',
        );
      }
      /** The upload door — one type list, one size cap — for every insert and every replace. */
      return importImage(
        { headers: { 'Content-Type': input.file.type }, body: input.file },
        async (res) => {
          const code = await res.json().then((b) => b?.error).catch(() => null);
          return res.status === 413
            ? 'That image is too large to upload.'
            : res.status === 403
              ? 'You have reached your artifact limit.'
              : code === 'invalid_image'
                ? 'That image type is not supported (png, jpeg, webp, gif, svg).'
                : 'Could not upload that image.';
        },
        'Upload failed — check your connection and try again.',
      );
    },
    async versions() {
      const res = await fetch(`${mine}/versions`);
      return res.ok ? ((await res.json()) as { versions: ArtifactVersionSummary[] }).versions : null;
    },
    async version(n) {
      const res = await fetch(`${mine}/versions/${n}`);
      return res.ok ? ((await res.json()) as ArtifactVersionSnapshot) : null;
    },
    async revert(input) {
      return answer(await artifactRequests(id).revert(input));
    },
    live(handlers) {
      const source = new EventSource(`/a/${id}/events`);
      source.onmessage = (event) => {
        let ping: ArtifactVersionPing;
        try { ping = JSON.parse(event.data) as ArtifactVersionPing; } catch { return; }
        handlers.onPing(ping);
      };
      source.addEventListener(STORY_DATA_EVENT, (event: MessageEvent) => {
        try { handlers.onData(JSON.parse(event.data) as ArtifactDataEvent); } catch { /* a malformed frame is a dropped wakeup, nothing more */ }
      });
      source.addEventListener(STORY_ANNOTATIONS_EVENT, () => handlers.onAnnotations());
      return () => source.close();
    },
    async liveFrame() {
      const r = await fetch(`/a/${id}/events/frame`, { credentials: 'same-origin' });
      return r.ok ? ((await r.json()) as ArtifactLiveEvent) : null;
    },
    queryTransport: () => createAuthenticatedTransport(id),

    // ── comments ────────────────────────────────────────────────────────────
    listAnnotations(status, options = {}) {
      return readAnnotationPages(`${mine}/annotations${status ? `?status=${status}` : ''}`, options);
    },
    async createAnnotation(body, idempotencyKey) {
      const res = await fetch(`${mine}/annotations`, {
        method: 'POST', headers: { ...JSON_HEADERS, 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body),
      });
      if (res.ok) return (await res.json()) as AnnotationWire;
      const refusal: unknown = await res.json().catch(() => null);
      const code = refusal && typeof refusal === 'object' ? (refusal as { error?: unknown; code?: unknown }) : {};
      throw new BackendRequestError(
        annotationFailure(res.status, refusal),
        res.status,
        code.error === SIGN_IN_REQUIRED || code.code === SIGN_IN_REQUIRED,
      );
    },
    async actOnAnnotation(annotationId, body) {
      const res = await fetch(`${mine}/annotations/${annotationId}`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
      if (!res.ok) throw new BackendRequestError(`Could not update this comment (${res.status})`, res.status);
      return (await res.json()) as AnnotationWire;
    },
    async deleteAnnotation(annotationId) {
      const res = await fetch(`${mine}/annotations/${annotationId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not delete this comment. Try again.');
    },
    async uploadCommentImage(form) {
      const response = await fetch(`${mine}/comment-images`, { method: 'POST', body: form });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error === 'stale' ? 'The document changed. Your draft is preserved; retake the screenshot.' : result.error === 'quota_exceeded' ? 'Image storage quota reached.' : 'Could not upload the screenshot. Please retry.');
      }
      return (await response.json()) as { id: string };
    },
    async members(query, options = {}) {
      const r = await fetch(`/api/my/artifacts/${encodeURIComponent(id)}/members${query === undefined ? '' : `?query=${encodeURIComponent(query)}`}`, { signal: options.signal });
      return r.ok ? ((await r.json()) as MembersAnswer) : null;
    },
    async remoteSessions(options = {}) {
      const r = await fetch('/api/remote/sessions', { credentials: 'same-origin', signal: options.signal });
      return r.ok ? ((await r.json()) as RemoteSessionsAnswer) : { sessions: [] };
    },
    async deleteRemoteSession(sessionId) {
      const response = await fetch(`/api/remote/sessions/${sessionId}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? 'Could not remove agent. Try again.');
      }
    },
  };
}
