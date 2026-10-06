/* @jsxImportSource solid-js */
/**
 * The single `/:user/*` route for profile artifact aliases. It stays separate from the public
 * profile index so valid artifacts do not pull the shelf/search UI into their reader startup.
 */
import { createMemo, lazy, Show, type JSX } from 'solid-js';
import { useLocation, useParams } from '@solidjs/router';
import { artifactViewPath, parsePrettyPath } from '@/lib/http/urls';
import { servedDocumentFrame } from '@/web/served-frame';

// These branches load only when selected: a bare handle needs the profile page, an invalid alias
// needs the 404, and a resolved artifact uses the existing address/document renderers.
const ProfilePage = lazy(() => import('./Profile').then((m) => ({ default: m.ProfilePage })));
const NotFoundPage = lazy(() => import('./NotFound').then((m) => ({ default: m.NotFoundPage })));
const ArtifactAddressRoute = lazy(() => import('./ArtifactAddress').then((m) => ({ default: m.ArtifactAddressRoute })));
const DocumentPage = lazy(() => import('./Document').then((m) => ({ default: m.DocumentPage })));

/**
 * `/:user/*` covers every pretty alias, including `/@user/<id>-slug[/edit]` and address healing.
 * Keep it as one route: a named alias sibling overlaps the profile's one-segment paths. Resolution
 * follows the shared id-anchored URL grammar; the served-frame check retains the same document vs
 * artifact-address choice as `/a/:id`.
 */
export function ProfileAliasRoute(): JSX.Element {
  const params = useParams<{ user: string; rest?: string }>();
  const location = useLocation();
  const bare = createMemo(() => !(params.rest ?? '').split('/').filter(Boolean).length);
  const editing = createMemo(() => /\/edit\/?$/.test(location.pathname));
  const id = createMemo(() => parsePrettyPath(artifactViewPath(params.rest ?? '').split('/').filter(Boolean))?.id ?? null);
  return <Show when={!bare()} fallback={<ProfilePage />}>
    <Show when={id()} fallback={<NotFoundPage />}>
      {resolvedId => <Show when={servedDocumentFrame()} fallback={<ArtifactAddressRoute id={resolvedId()} editing={editing()} />}><DocumentPage /></Show>}
    </Show>
  </Show>;
}
