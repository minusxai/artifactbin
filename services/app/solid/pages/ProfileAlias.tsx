/* @jsxImportSource solid-js */
import { createEffect, createMemo, lazy, Show, type JSX } from 'solid-js';
import { useLocation, useParams } from '@solidjs/router';
import { artifactViewPath, parsePrettyPath, titleSlug } from '@/lib/http/urls';
import { servedArtifactId } from '@/solid/lib/bootstrap';
import { replaceDocument } from '@/solid/lib/document-navigation';
import { servedAt, servedDocumentFrame } from '@/solid/lib/served-frame';

// Artifact aliases are a small route entry: reading a document must not load profile UI.
// Each destination stays a lazy browser chunk, including the trailing-slash profile fallback.
const NotFoundPage = lazy(() => import('./NotFound').then(m => ({ default: m.NotFoundPage })));
const ProfilePage = lazy(() => import('./Profile').then(m => ({ default: m.ProfilePage })));
const ArtifactAddressRoute = lazy(() => import('./ArtifactAddress').then(m => ({ default: m.ArtifactAddressRoute })));
const DocumentPage = lazy(() => import('./Document').then(m => ({ default: m.DocumentPage })));

/**
 * `/:user/*` — every pretty artifact alias, e.g. `/@user/<id>-slug[/edit]` (also reached by address
 * healing: server/app documentPreparation renders a `/a/<id>[/edit]` request at this address once its
 * owner has a username). The ONE route for this shape — a sibling route keyed on a single named
 * segment would overlap it and, being listed first, win the match for every one-segment alias
 * (folders included), same as `/a/:id` does with `ArtifactRoute` in solid/App.tsx.
 *
 * Resolution is id-anchored, same grammar as the rest of the app (lib/urls
 * parsePrettyPath) — the difference is what Solid does once it has the id: `servedDocumentFrame()`
 * (the same discriminator `ArtifactRoute` uses for `/a/:id`) says whether THIS load served a document's
 * frame, so a framed document is adopted by the document page (`DocumentPage`) and anything else — a
 * folder, a data tier, the starter, a dataset editor — is routed by its answer (`ArtifactAddressRoute`)
 * instead of guessing from the URL shape alone. "Nesting is not in the address" (see
 * the profile API's own doc comment): a rest path that fails to parse as an id is a uniform 404, never
 * a listing — there is no profile sub-page below the handle.
 */
export function ProfileAliasRoute(): JSX.Element {
  const params = useParams<{ user: string; rest?: string }>();
  const location = useLocation();
  // A trailing slash (`/@user/`) is the bare handle, same as `/@user` — not a rest path.
  const bare = createMemo(() => !(params.rest ?? '').split('/').filter(Boolean).length);
  const editing = createMemo(() => /\/edit\/?$/.test(location.pathname));
  const segments = createMemo(() => artifactViewPath(params.rest ?? '').split('/').filter(Boolean));
  // A title-slug address (`/@user/<title-slug>`, lib/artifacts/slug-address) names its page by the server's answer.
  const served = createMemo(() => servedArtifactId(location.pathname));
  const id = createMemo(() => served() ?? parsePrettyPath(segments())?.id ?? null);
  // Reached by a client navigation, a one-segment slug is the server's to resolve: cross to it. An address the server
  // already answered is never sent back.
  const crossing = createMemo(() => segments().length === 1 && titleSlug(segments()[0]) === segments()[0] && !served() && !servedAt(location.pathname));
  createEffect(() => { if (crossing()) replaceDocument(window.location.pathname + window.location.search + window.location.hash); });
  return <Show when={!bare()} fallback={<ProfilePage />}>
    <Show when={!crossing() && id()} fallback={<Show when={!crossing()}><NotFoundPage /></Show>}>
      {resolvedId => <Show when={servedDocumentFrame()} fallback={<ArtifactAddressRoute id={resolvedId()} editing={editing()} />}><DocumentPage /></Show>}
    </Show>
  </Show>;
}

