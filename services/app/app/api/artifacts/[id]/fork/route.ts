import { withTokenAuth } from '@/lib/auth';
import { runOperation } from '@/lib/operations/http';
import { json } from '@/lib/http';

/**
 * ABSENT and MALFORMED are different facts, and this door is the one place in
 * the API where they must answer differently.
 *
 * A fork's body holds nothing but the three optional overrides, so sending
 * none is the ordinary fork — "keep everything" — and a 400 there would make
 * the common call the awkward one. But a body that WAS sent and does not
 * parse cannot be read as "no overrides": the JSON the caller meant may have
 * been `{"visibility":"private"}`, and publishing the copy at the SOURCE's
 * visibility with a 201 is exactly the silent downgrade
 * `private_requires_account` exists to refuse. `readJson` collapses both into
 * `null`, which is why this reads the text itself.
 */
function overridesFrom(raw: string): Record<string, unknown> | null {
  if (raw.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * POST /api/artifacts/:id/fork { title?, visibility?, folder? } — the
 * `fork_artifact` OPERATION: copy anything this token can READ into a new
 * artifact of its own.
 *
 * The browser's own fork door (/api/my/artifacts/:id/fork) is untouched: same
 * `forkArtifact`, different credential.
 */
export const POST = withTokenAuth(async (request: Request, { tokenId, userId, params }) => {
  const overrides = overridesFrom(await request.text());
  if (!overrides) return json({ error: 'invalid_json' }, 400);
  return runOperation('fork_artifact', request, { tokenId, userId }, { ...overrides, id: params.id });
});
