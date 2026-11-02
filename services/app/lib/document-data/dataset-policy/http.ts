import type { AccessActor } from '@/lib/accounts';
import { json } from '@/lib/http';
import { setDatasetPolicy } from '.';

/**
 * Set a dataset's stored policy (version 3 or null) with revision compare-and-swap. The policy API
 * (lib/dataset-graphql `writeDatasetPermissions`) answers v3 bodies itself and saves null through here; version 1
 * and 2 bodies are refused (LEGACY_POLICY_REFUSED).
 */
export async function writeDatasetPolicy(
  actor: AccessActor,
  id: string,
  body: Record<string, unknown>,
): Promise<Response> {
  if (!Object.hasOwn(body, 'policy'))
    return json({ error: 'invalid_policy' }, 400);
  try {
    const result = await setDatasetPolicy(
      actor,
      id,
      body.policy,
      body.expectedPolicyRevision as number,
    );
    if (!result) return json({ error: 'not_found' }, 404);
    if ('conflict' in result)
      return json(
        {
          error: 'policy_changed',
          detail: 'Reload the current policy before saving.',
        },
        409,
      );
    return json(result);
  } catch (error) {
    return json(
      {
        error: 'invalid_policy',
        detail: error instanceof Error ? error.message : 'Invalid policy',
      },
      400,
    );
  }
}
