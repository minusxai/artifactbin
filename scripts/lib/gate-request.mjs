/** TEST ONLY: Node fixtures impersonating a legitimate main-page request.
 * Never use these headers on cross-origin/CSRF denial probes. Browser evaluate
 * callbacks need only the marker; Chromium supplies Origin and Fetch Metadata. */
export function browserGateHeaders(base) {
 return {'Content-Type':'application/json',origin:new URL(base).origin,'sec-fetch-site':'same-origin','x-artifactbin-csrf':'1'};
}
