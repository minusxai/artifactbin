/** Authentication vocabulary shared by CLI, proxy consent and app token minting. */
export const ARTIFACT_SCOPE = 'artifacts';
/** Lets a person's own agent call MinusX with its Artifactbin token (cross-repository contract §4.1); never alone. */
export const MINUSX_SCOPE = 'minusx';
/** Every scope a grant may carry, in the canonical order a stored scope is written. */
export const GRANTABLE_SCOPES = [ARTIFACT_SCOPE, MINUSX_SCOPE] as const;
/**
 * A requested OAuth scope (space-delimited) as the canonical string a token stores, or null when it names an
 * unknown scope or lacks `artifacts`: every grant can publish, and `minusx` only ever adds to that.
 */
export function grantScope(requested: string): string | null {
  const names = requested.split(/\s+/).filter(Boolean);
  if (!names.includes(ARTIFACT_SCOPE) || names.some((name) => !(GRANTABLE_SCOPES as readonly string[]).includes(name))) return null;
  return GRANTABLE_SCOPES.filter((name) => names.includes(name)).join(' ');
}
export const API_RESOURCE_PATH = '/api';

/** Public delivery hint; never contains the code, address, or operator outbox path. */
export const CODE_DELIVERY_HEADER = 'x-artifactbin-code-delivery';
export type CodeDelivery = 'email' | 'operator_outbox';
export function codeDeliveryOf(value: unknown): CodeDelivery | undefined {
  return value === 'email' || value === 'operator_outbox' ? value : undefined;
}
