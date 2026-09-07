/** Runs before ANY author code. Denies WebRTC, which connect-src does not cover.
 * Denials must be immutable; no saved native constructor may reach author code.
 */
export const AUTHOR_REALM_LOCKDOWN = `
for (const name of ['RTCPeerConnection','webkitRTCPeerConnection','mozRTCPeerConnection']) {
  Object.defineProperty(globalThis,name,{value:undefined,writable:false,configurable:false});
}
`;
