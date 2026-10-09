/**
 * GET /a/:id/story?surface=raw|app&<the page's own query> — THE STORY FRAGMENT (docs/phase2-architecture.md
 * §2.4, lib/story-runtime/story-fragment): a compiled page's newest version, the same assembler output the
 * page that asks is served, which the live morph (lib/islands/morph/engine) draws in place.
 *
 * The raw route answers it (`fragment`), so the admission, the uniform 404, the compiled inputs and the
 * sandbox are `/raw`'s own and cannot drift: this door adds a surface and takes away the view event.
 */
import { GET as rawDocument } from '../raw/route';
import { STORY_SURFACE_PARAM } from '@/lib/story-runtime/story-fragment';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const surface = new URL(request.url).searchParams.get(STORY_SURFACE_PARAM) === 'app' ? 'app' : 'raw';
  return rawDocument(request, { params: ctx.params, fragment: { surface } });
}
