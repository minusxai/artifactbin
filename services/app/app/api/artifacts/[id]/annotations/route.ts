/**
 * GET /api/artifacts/:id/annotations — the annotation list, anchors in
 * CURRENT coordinates. `?status=open` (default) | `resolved` | `all`.
 *
 * This is the history/debug view; the primary read is the artifact GET
 * itself, which inlines the open set — an agent never needs a second call to
 * see the feedback. Uniform 404 for an unreachable id, like every scoped
 * read.
 */
import { listAnnotationsFor, type AnnotationWire } from '@/lib/annotations';
import { withTokenAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import type { TokenActor } from '@/lib/artifacts';

const STATUSES = new Set(['open', 'resolved', 'all']);

/** Shared by both doors: the ?status= vocabulary and the {annotations} envelope. */
export async function respondToAnnotationList(request: Request, actor: TokenActor, id: string): Promise<Response> {
  const raw = new URL(request.url).searchParams.get('status') ?? 'open';
  if (!STATUSES.has(raw)) return json({ error: 'invalid_status' }, 400);
  const list: AnnotationWire[] | null = await listAnnotationsFor(actor, id, { status: raw as 'open' | 'resolved' | 'all' });
  if (!list) return json({ error: 'not_found' }, 404);
  return json({ annotations: list });
}

export const GET = withTokenAuth((request, { tokenId, userId, params }) =>
  respondToAnnotationList(request, { tokenId, userId }, params.id),
);
