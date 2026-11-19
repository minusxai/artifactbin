/**
 * THE SERVICE PAYLOAD LIMIT: the one bound on a JSON body a trusted service sends or receives through the identity
 * relay and its app seams (chart images and draft checks).
 * A relay that carries these calls further (an agent sandbox's bridge) holds the same number, so every hop refuses
 * at the same size and names it. Past it the answer is 413 `{error:'too_large', max}`.
 */
export const SERVICE_PAYLOAD_LIMIT = 4 * 1024 * 1024;
/** Room kept under SERVICE_PAYLOAD_LIMIT for the JSON a payload is wrapped in on its way (keys, base64 padding). */
export const SERVICE_PAYLOAD_ENVELOPE = 64 * 1024;
