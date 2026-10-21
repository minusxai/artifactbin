// @ts-check
/** Neutral policy shared by secret storage, the host and the sandbox. Kept
 * beside the supervisor so Docker copies the same source, not a second policy. */
export const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
export const SECRET_VALUE_MAX_BYTES = 4096;
export const MAX_SECRETS_PER_ACCOUNT = 64;
export const BACKEND_ENV_MAX_VALUE_BYTES = MAX_SECRETS_PER_ACCOUNT * SECRET_VALUE_MAX_BYTES;
const encoder = new TextEncoder();
/** @param {unknown} value @returns {value is string} */
export function validSecretName(value) {
  return typeof value === 'string' && SECRET_NAME.test(value);
}
/** @param {unknown} value @returns {value is string} */
export function validSecretValue(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0') && encoder.encode(value).length <= SECRET_VALUE_MAX_BYTES;
}
/** @param {unknown} value @returns {Record<string,string>} */
export function checkedBackendEnv(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
      Object.getOwnPropertySymbols(value).length) throw new TypeError('Invalid backend environment');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Object.keys(descriptors).sort();
  if (names.length > MAX_SECRETS_PER_ACCOUNT) throw new TypeError('Invalid backend environment');
  /** @type {Record<string,string>} */
  const copy = {};
  let bytes = 0;
  for (const name of names) {
    const property = descriptors[name];
    if (!property || !property.enumerable || !('value' in property) ||
        !validSecretName(name) || !validSecretValue(property.value)) throw new TypeError('Invalid backend environment');
    bytes += encoder.encode(property.value).length;
    if (bytes > BACKEND_ENV_MAX_VALUE_BYTES) throw new TypeError('Invalid backend environment');
    copy[name] = property.value;
  }
  return copy;
}
