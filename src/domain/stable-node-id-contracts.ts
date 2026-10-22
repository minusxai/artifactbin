/** Transport bound for an opaque, immutable data-af-id. Never truncate or re-encode an identity.
 * 16 KiB accommodates percent-encoded owner/key/source/cell components of 256 UTF-16 units,
 * including three-byte Unicode (four components alone can occupy 9 KiB after encoding).
 * Arbitrarily long authored DOM attributes are not an unbounded wire contract.
 */
export const STABLE_NODE_ID_MAX_BYTES = 16 * 1024;
/** Accept a nonempty, well-formed Unicode string within the UTF-8 byte budget;
 * reject control characters and lone surrogates. Prototype-looking names are valid opaque identities.
 * Preserve all accepted bytes.
 */
export type StableNodeIdValidator = (value: unknown) => value is string;
