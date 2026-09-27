/**
 * GET /assets/mermaid/<sha256>.svg — a prerendered Mermaid drawing
 * (lib/mermaid-images), content-addressed by engine, mode, palette and code.
 *
 * Served like every other stored asset that may be markup (app/assets/[hash]):
 * `immutable`, because the address IS the content; `nosniff`, so the browser
 * holds to the type we stored; `Content-Security-Policy: sandbox` and
 * `attachment`, so a top-level navigation to it is an opaque, scriptless
 * download rather than a page in this origin. An `<img>` — the only way the
 * kit shows it — is unaffected by all three. The bytes passed the sanitizer
 * before they were stored (lib/mermaid-images/sanitize). An unknown key is a
 * routine 404: the key comes from the caller.
 */
import { ASSET_HEADERS } from '@/app/assets/[hash]/route';
import { MERMAID_IMAGE_FILE, mermaidImageBytes } from '@/lib/mermaid-images/store';

export async function GET(_request: Request, ctx: { params: Promise<{ file: string }> }) {
  const match = MERMAID_IMAGE_FILE.exec((await ctx.params).file);
  const bytes = match ? await mermaidImageBytes(match[1]!) : null;
  if (!bytes) return new Response('not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  return new Response(new Uint8Array(bytes), {
    status: 200,
    // Built fresh per response (see app/assets/[hash]): the server writes Content-Length back into it.
    headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', ...ASSET_HEADERS },
  });
}
export const HEAD = GET;
