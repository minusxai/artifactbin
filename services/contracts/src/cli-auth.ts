/** Authentication vocabulary shared by CLI, proxy consent and app token minting. */
export const ARTIFACT_SCOPE = 'artifacts';
export const API_RESOURCE_PATH = '/api';
export const CLI_PROTOCOL_VERSION = 3;

/** Public delivery hint; never contains the code, address, or operator outbox path. */
export const CODE_DELIVERY_HEADER = 'x-artifactbin-code-delivery';
export type CodeDelivery = 'email' | 'operator_outbox';
export function codeDeliveryOf(value: unknown): CodeDelivery | undefined {
  return value === 'email' || value === 'operator_outbox' ? value : undefined;
}
