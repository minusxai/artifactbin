/**
 * The artifact page's data, as JSON — the SPA's client navigation door. The
 * answer itself (ACL, prepared reader runtime, per-viewer overlay, the
 * editor's `?part=editor` door) is lib/artifact-page, shared with the app page
 * that inlines it (server/app).
 */
import { artifactPageResponse } from '@/lib/artifact-page';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return artifactPageResponse(request, id);
}
