/**
 * Pure setup planning: the questions, CLI contract, validation, and rendered
 * environment file. The runner owns every side effect.
 *
 * The example is snapshotted because the runtime image deliberately contains
 * only the setup modules; decoding this constant is deterministic and
 * keeps this module free of filesystem I/O. The snapshot is GENERATED —
 * `npm run generate:env-snapshot` writes it from `.env.example`, and
 * `scripts/__tests__/setup-plan.test.mjs` fails when the two have drifted.
 */

const DEFAULT_PUBLIC_URL = 'http://localhost:3030';

// Generated from .env.example — do not hand-edit; run `npm run generate:env-snapshot`.
const ENV_EXAMPLE_BASE64 = 'IyBSdW4gYG5wbSBydW4gc2V0dXBgIHRvIGdlbmVyYXRlIGEgc2VjdXJlIGAuZW52YCBmb3IgdGhpcyBjaGVja291dC4KCiMgRW5hYmxlcyBvcGVyYXRpb25hbCB0b2tlbiBtaW50L3Jldm9rZSBlbmRwb2ludHMuIEdlbmVyYXRlIHdpdGg6IG9wZW5zc2wgcmFuZCAtYmFzZTY0IDMyCkFETUlOX19TRUNSRVQ9CgojIFNpZ25zIGxvZ2luIHNlc3Npb25zLiBHZW5lcmF0ZSB3aXRoOiBvcGVuc3NsIHJhbmQgLWJhc2U2NCAzMgpBVVRIX19TRUNSRVQ9CgojIFVuc2V0IHVzZXMgZW1iZWRkZWQgUEdMaXRlIGF0IC4vZGF0YS9wZ2xpdGUuIEFsc28gYWNjZXB0cyBwZ2xpdGU6Ly9tZW1vcnkgb3IgUG9zdGdyZXMuCiMgREFUQUJBU0VfVVJMPXBnbGl0ZTovLy4vZGF0YS9wZ2xpdGUKCiMgUHVibGljIG9yaWdpbiBhbmQgbGlzdGVuaW5nIHBvcnQuIEFQUF9fSE1SX1BPUlQgZGVmYXVsdHMgdG8gQVBQX19QT1JUICsgMS4KQVBQX19QVUJMSUNfQkFTRV9VUkw9aHR0cDovL2xvY2FsaG9zdDozMDMwCiMgT3B0aW9uYWwgZGVkaWNhdGVkIG9yaWdpbiB0aGF0IHNlcnZlcyBvbmx5IGFub255bW91cyBjYWNoZWQgYnl0ZXMgYXQgL2Fzc2V0cy8qLgojIFByb2R1Y3Rpb24gcmVxdWlyZXMgYSBkaXN0aW5jdCBIVFRQUyBob3N0bmFtZTsgSFRUUCBpcyBhY2NlcHRlZCBvbmx5IG9uIGxvb3BiYWNrLgojIEFQUF9fQVNTRVRTX09SSUdJTj1odHRwczovL2Fzc2V0cy5leGFtcGxlLmNvbQojIE90aGVyIG9yaWdpbnMgdGhpcyBzYW1lIGRlcGxveW1lbnQgYW5zd2VycyBhdCAoYSBtYXJrZXRpbmcgaG9zdG5hbWUgdGhhdCBwcm94aWVzCiMgaGVyZSwgYSBwcmV2aW91cyBuYW1lKS4gQ29tbWEtc2VwYXJhdGVkOyBIVFRQUywgb3IgSFRUUCBvbiBsb29wYmFjazsgbm8gcGF0aCBvcgojIGNyZWRlbnRpYWxzLiBTZXJ2ZWQgYXQgR0VUIC9hcGkvc2VydmVyLCBzbyBhZmJpbiB0cmVhdHMgYSBsaW5rIG9yIGEgZm9sZGVyIGZyb20KIyBlaXRoZXIgbmFtZSBhcyB0aGlzIHNlcnZlcjsgcmVxdWVzdHMgYW5kIGNyZWRlbnRpYWxzIHN0aWxsIGdvIHRvCiMgQVBQX19QVUJMSUNfQkFTRV9VUkwgYWxvbmUuIEEgbWFsZm9ybWVkIGVudHJ5IHJlZnVzZXMgdGhlIGJvb3QuCiMgQVBQX19BTElBU19PUklHSU5TPWh0dHBzOi8vZXhhbXBsZS5jb20KIyBTZXJ2ZSBldmVyeSBkb2N1bWVudCBvbiBpdHMgb3duIG9yaWdpbiwgPGhleCBpZD4uPHRoaXMgaG9zdD4sIGZyYW1lZCBieSB0aGUgYXBwIHBhZ2UuCiMgQSBiYXJlIGhvc3RuYW1lIHVuZGVyIHRoZSBhcHAncyByZWdpc3RyYWJsZSBkb21haW4gKHNhbWUgc2l0ZSksIGUuZy4gcGFnZXMuZXhhbXBsZS5jb207CiMgc2NoZW1lIGFuZCBwb3J0IGZvbGxvdyBBUFBfX1BVQkxJQ19CQVNFX1VSTC4gVW5zZXQga2VlcHMgZG9jdW1lbnRzIGluc2lkZSB0aGUgYXBwIHBhZ2UuCiMgRGV2ZWxvcG1lbnQ6IGx2aC5tZSwgYnJvd3NpbmcgdGhlIGFwcCBhdCBodHRwOi8vYXBwLmx2aC5tZTo8cG9ydD4gKG5wbSBydW4gc2V0dXAgLS0gLS1wYWdlcy1ob3N0KS4KIyBBUFBfX1BBR0VTX0hPU1Q9CkFQUF9fUE9SVD0zMDMwCiMgQVBQX19IT1NUPQpBUFBfX0hNUl9QT1JUPQoKIyBQZXItdG9rZW4gYXJ0aWZhY3QgY2FwOyAwIGRpc2FibGVzIHRoZSBjYXAuClFVT1RBX19BUlRJRkFDVFNfUEVSX1RPS0VOPTEwMDAKCiMgU3RvcmVkIGFzc2V0cyBwZXIgYWNjb3VudCAodXBsb2FkcyArIFVSTHMgaW1wb3J0ZWQgZmlyc3QpLCAxMCBHQjsgYW5vbnltb3VzIHRva2VucyBoYXZlIHRoZWlyIG93biBjYXAuIDAgZGlzYWJsZXMuCiMgQVNTRVRTX19NQVhfQllURVNfUEVSX1RPS0VOPTEwMDAwMDAwMDAwCgojIExvY2FsIGRldmVsb3BtZW50IHdyaXRlcyBsb2dpbiBtYWlsIHRvIC5hcnRpZmFjdGJpbi9kZXYtbWFpbC5qc29ubDsgcmVhZCBhIGNvZGUgd2l0aDoKIyAgIG5wbSBydW4gZGV2Om90cCAtLSB5b3VAZXhhbXBsZS5jb20KIyBPcHRpb25hbCBvdmVycmlkZSBmb3Igc3RhbmRhbG9uZSBwcm9jZXNzZXMgYW5kIHRlc3Qgb3JjaGVzdHJhdGlvbi4KIyBFTUFJTF9fREVWX09VVEJPWF9QQVRIPQojIFB1YmxpYyBkZXBsb3ltZW50cyByZXF1aXJlIGEgUmVzZW5kIGtleSBhbmQgdmVyaWZpZWQgc2VuZGVyLgpFTUFJTF9fUkVTRU5EX0FQSV9LRVk9CkVNQUlMX19GUk9NPWFydGlmYWN0YmluIDxsb2dpbkBleGFtcGxlLmNvbT4KCiMgVW5zZXQgUzNfVVJMIHN0b3JlcyBvYmplY3RzIGxvY2FsbHkuIFBlcmNlbnQtZW5jb2RlIGNyZWRlbnRpYWxzIGluIFMzIFVSTHMuCiMgUzNfVVJMPXMzOi8vS0VZOlNFQ1JFVEBzMy5yZWdpb24uYW1hem9uYXdzLmNvbS9idWNrZXQvcHJlZml4P3JlZ2lvbj1yZWdpb24KT0JKRUNUX1NUT1JFX19MT0NBTF9ESVI9LmFydGlmYWN0LW9iamVjdHMKCklNQUdFU19fTUFYX0JZVEVTPTUwMDAwMDAwClBERl9fTUFYX0JZVEVTPTUwMDAwMDAwCkZJTEVTX19NQVhfQllURVM9NTAwMDAwMDAKCiMgV2ViIGltcG9ydHMgYmxvY2sgcHJpdmF0ZSBuZXR3b3JrcyBieSBkZWZhdWx0LgpXRUJfSU5HRVNUX19BTExPV19QUklWQVRFPTAKV0VCX0lOR0VTVF9fVElNRU9VVF9NUz0xMDAwMApXRUJfSU5HRVNUX19NQVhfUEVSX0hPVVI9MzAwCgpTUUxfX01BWF9ST1dTPTEwMDAwClNRTF9fTUFYX1FVRVJZX1JPV1M9MTAwMDAKU1FMX19RVUVSWV9USU1FT1VUX01TPTUwMDAKCiMgTnVtYmVyIG9mIHRydXN0ZWQgZm9yd2FyZGluZyBob3BzIHVzZWQgdG8gaW50ZXJwcmV0IGNsaWVudCBhZGRyZXNzZXMuCkhUVFBfX1RSVVNURURfUFJPWFlfSE9QUz0xCgojIE9wdGlvbmFsIGRlcGxveW1lbnQgY29udHJvbHMuCiMgQVJUSUZBQ1RTX19BTExPV19QVUJMSUM9MQojIEN1c3RvbSBkb21haW5zIGZvciBwcm9maWxlczogdGhlIEROUyB0YXJnZXQgaG9zdG5hbWUgdXNlcnMgcG9pbnQgdGhlaXIgZG9tYWluIGF0CiMgKGEgQ05BTUUvQUxJQVMgdG8gaXQsIG9yIGFuIEEgcmVjb3JkIHRvIGl0cyBhZGRyZXNzKS4gVW5zZXQgb3IgZW1wdHkgdHVybnMgb2ZmCiMgYXR0YWNoaW5nIGFuZCB2ZXJpZnlpbmcgb25seTsgdmVyaWZpZWQgZG9tYWlucyBrZWVwIGJlaW5nIHNlcnZlZCBlaXRoZXIgd2F5LgojIEZMQUdfX0NVU1RPTV9ET01BSU5TPWRvbWFpbnMuZXhhbXBsZS5jb20KIyBBTkFMWVRJQ1NfX1NFQ1JFVD0KCiMgU3BsaXQtc2VydmljZSBkZXBsb3ltZW50LiBJTlRFUk5BTF9fU0VSVklDRV9TRUNSRVQgbXVzdCBtYXRjaCBhY3Jvc3MgYXBwLCBTUUwsIGJyb3dzZXIgYW5kIGV2ZW50cy4KIyBDT05UUkFDVF9fQUNUT1JfU0VDUkVUPQojIEJST1dTRVJfX1NFUlZJQ0VfVVJMPWh0dHA6Ly9icm93c2VyOjgwODAKIyBPcHRpb25hbCBkaXJlY3QgZXhwb3J0IHVwbG9hZDsgZXhhY3QgUzMgb3JpZ2luIGFuZCBleHBvcnQgb2JqZWN0IHByZWZpeCBvbmx5LgojIEJST1dTRVJfX1VQTE9BRF9PUklHSU49aHR0cHM6Ly9idWNrZXQuczMudXMtd2VzdC0xLmFtYXpvbmF3cy5jb20KIyBCUk9XU0VSX19VUExPQURfUFJFRklYPS9hcnRpZmFjdHMvZXhwb3J0cy9vYmplY3RzLwojIEludGVybmFsLW9ubHkgYnJvd3NlcnMgcmVhY2ggUzMgdGhyb3VnaCB0aGUgc2NvcGVkIHVwbG9hZCBnYXRld2F5LgojIEJST1dTRVJfX1VQTE9BRF9QUk9YWV9VUkw9aHR0cDovL3VwbG9hZC1nYXRld2F5OjgwODAKIyBCcm93c2VyIHNlc3Npb25zIHJlcXVpcmUgTGludXggYnViYmxld3JhcCB3aXRoIHVucHJpdmlsZWdlZCB1c2VyIG5hbWVzcGFjZXMuCiMgREVWRUxPUE1FTlQgT05MWS4gQlJPV1NFUl9fU0FOREJPWD1ub25lIHJ1bnMgdGhlIHNlc3Npb24gd29ya2VyIGFzIGEgcGxhaW4gY2hpbGQKIyBwcm9jZXNzOiBubyBidWJibGV3cmFwLCBubyBjZ3JvdXAsIE5PIE9TIGNvbnRhaW5tZW50IOKAlCBhIHNlc3Npb24gc2NyaXB0IHRoZW4gaGFzIHRoZQojIHdob2xlIG1hY2hpbmUsIHRoaXMgY2hlY2tvdXQgYW5kIHRoZSBuZXR3b3JrLiBJdCBleGlzdHMgc28gbGl2ZSBzZXNzaW9ucyBydW4gb24gYQojIG1hY09TIGRldiBob3N0IGF0IGFsbDsgYG5wbSBydW4gZGV2YCBhbHJlYWR5IGRlZmF1bHRzIGl0IHRoZXJlLiBJdCBpcyByZWZ1c2VkIHdoZW4KIyBOT0RFX0VOVj1wcm9kdWN0aW9uLCBhbmQgYW55IG90aGVyIHZhbHVlIGlzIHJlZnVzZWQgb3V0cmlnaHQuIE5ldmVyIHNldCBpdCBvbiBhIHNlcnZlci4KIyBCUk9XU0VSX19TQU5EQk9YPW5vbmUKIyBTcGxpdCBicm93c2VyIHNlcnZpY2U6IHRydXN0ZWQgYXBwIFVSTDsgYWxzbyBzZXQgQVBQX19QVUJMSUNfQkFTRV9VUkwgYW5kIENPTlRSQUNUX19BQ1RPUl9TRUNSRVQgdGhlcmUuCiMgQlJPV1NFUl9fU0VTU0lPTl9BUFBfVVJMPWh0dHA6Ly9hcHA6ODA4MAojIFdyaXRhYmxlIGRlbGVnYXRlZCBjZ3JvdXAgdjIgc3VidHJlZSB3aXRoIGNwdSwgbWVtb3J5IGFuZCBwaWRzIGNvbnRyb2xsZXJzIGVuYWJsZWQuCiMgQlJPV1NFUl9fU0VTU0lPTl9DR1JPVVBfUk9PVD0vc3lzL2ZzL2Nncm91cC9hZmJpbi1zZXNzaW9ucwojIExpdmUgYnJvd3NlciBzZXNzaW9ucyB0aGlzIHNlcnZpY2UgaG9sZHMsIHNoYXJlZCBieSBldmVyeSBvd25lciwgYW5kIGhvdyBtYW55IG9uZQojIGNyZWRlbnRpYWwgbWF5IGhvbGQuIFdob2xlIG51bWJlcnMgb2YgYXQgbGVhc3QgMTsgZWFjaCBzZXNzaW9uIHN0aWxsIGdldHMgMSBHaUIuCiMgQlJPV1NFUl9fU0VTU0lPTl9NQVg9MgojIEJST1dTRVJfX1NFU1NJT05fTUFYX1BFUl9BQ1RPUj0yCiMgSU5URVJOQUxfX1NFUlZJQ0VfU0VDUkVUPQojIFNRTF9fU0VSVklDRV9VUkw9aHR0cDovL3NxbDo4MDgwCiMgRXZlbnRzIHVzZSB0aGUgbG9jYWwgZGF0YWJhc2UgdW5sZXNzIGFuIEhUVFAgc2VydmljZSBVUkwgaXMgY29uZmlndXJlZC4KIyBFVkVOVFNfX1NFUlZJQ0VfVVJMPWh0dHA6Ly9ldmVudHM6ODA4MAojIEVWRU5UU19fU0NIRU1BPWV2ZW50cwpFWFBPUlRfX0lOVEVSTkFMX09SSUdJTj0KCiMgT3B0aW9uYWwgZGF0YWJhc2Ugc2NoZW1hIG5hbWVzLgojIEFVVEhfX1NDSEVNQT1hdXRoCiMgQVBQX19TQ0hFTUE9YXBwCgojIE9wdGlvbmFsIEdvb2dsZSBsb2dpbi4KIyBBVVRIX19HT09HTEVfQ0xJRU5UX0lEPQojIEFVVEhfX0dPT0dMRV9DTElFTlRfU0VDUkVUPQoKIyBPcHRpb25hbCBPSURDIGxvZ2luLiBVc2UgZXhwbGljaXQgZW5kcG9pbnRzIG9yIGRpc2NvdmVyeSwgbm90IGJvdGguCiMgQVVUSF9fT0lEQ19QUk9WSURFUl9JRD1vaWRjCiMgQVVUSF9fT0lEQ19DTElFTlRfSUQ9CiMgQVVUSF9fT0lEQ19DTElFTlRfU0VDUkVUPQojIEFVVEhfX09JRENfQVVUSE9SSVpBVElPTl9VUkw9CiMgQVVUSF9fT0lEQ19UT0tFTl9VUkw9CiMgQVVUSF9fT0lEQ19VU0VSSU5GT19VUkw9CiMgQVVUSF9fT0lEQ19ESVNDT1ZFUllfVVJMPQoKCiMgUGVybWl0IFBvc3RncmVzIGNvbm5lY3Rpb25zIHRvIGxvb3BiYWNrL3ByaXZhdGUgbmV0d29ya3MgKHNlbGYtaG9zdGVkIGRlcGxveW1lbnRzIG9ubHkpLgojIExpbmstbG9jYWwsIG1ldGFkYXRhLCBtdWx0aWNhc3QgYW5kIHVuc3BlY2lmaWVkIGRlc3RpbmF0aW9ucyByZW1haW4gYmxvY2tlZC4KREFUQVNFVF9fQUxMT1dfUFJJVkFURV9ORVRXT1JLUz1mYWxzZQojIE9wdGlvbmFsIGNvbW1hLXNlcGFyYXRlZCBsaXRlcmFsIEROUyBzZXJ2ZXIgSVBzIGZvciBkYXRhc2V0IFBvc3RncmVTUUwgaG9zdCByZXNvbHV0aW9uIG9ubHkuCiMgRW1wdHkgdXNlcyB0aGUgb3BlcmF0aW5nIHN5c3RlbSByZXNvbHZlci4KREFUQVNFVF9fRE5TX1NFUlZFUlM9CgojIENMSS1vbmx5IHNlcnZpY2UgbWlycm9yOiBleHBvcnQgdGhpcyBpbiB0aGUgc2hlbGwgcnVubmluZyBhZmJpbjsgY2hlY2tzdW1zIHJlbWFpbiBwaW5uZWQuCiMgQW4gSFRUUFMgYmFzZSBVUkwgKG9wdGlvbmFsIHBhdGggcHJlZml4KSwgb3IgSFRUUCBsb29wYmFjazsgc2VydmVzIGFmYmluLXZWRVJTSU9OL2FmYmluLXNxbC1PUy1BUkNILmd6LgojIENMSV9fU0VSVklDRV9CQVNFX1VSTD0KCiMgQ0xJLW9ubHk6IGV4cG9ydGVkIHNldHRpbmdzIGZvciBtYW5hZ2VkIHN0YW5kYWxvbmUgYmFja2dyb3VuZCB1cGRhdGVzLgojIFNldCB0byAwIHRvIGRpc2FibGUgYXV0b21hdGljIGRpc2NvdmVyeSBhbmQgaW5zdGFsbGF0aW9uIChleHBsaWNpdCBhZmJpbiB1cGRhdGUgc3RpbGwgd29ya3MpLgojIENMSV9fQVVUT19VUERBVEU9MQojIEEgdmVyc2lvbiBwaW4gZGlzYWJsZXMgYXV0b21hdGljIHVwZGF0ZXMgYW5kIHJlc3RyaWN0cyBleHBsaWNpdCB1cGRhdGVzIHRvIHRoYXQgcmVsZWFzZS4KIyBDTElfX1ZFUlNJT05fUElOPQo=';
const ENV_EXAMPLE = Buffer.from(ENV_EXAMPLE_BASE64, 'base64').toString('utf8');

function httpUrlError(value) {
  try {
    const url = new URL(String(value));
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname) return undefined;
  } catch {}
  return 'Public URL must be an absolute http(s) URL';
}

function portError(value) {
  return Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) < 65535
    ? undefined
    : 'Port must be an integer from 1 to 65534 so the adjacent HMR port is valid';
}

function postgresUrlError(value) {
  try {
    const url = new URL(String(value));
    if ((url.protocol === 'postgres:' || url.protocol === 'postgresql:') && url.hostname) return undefined;
  } catch {}
  return 'Database URL must be a Postgres URL';
}

/** APP__PAGES_HOST: a bare hostname (no scheme, port, path or wildcard), as services/app/lib/platform/config parsePagesHost reads it. */
function pagesHostError(value) {
  return /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(String(value).trim().toLowerCase())
    ? undefined
    : 'Pages host must be a bare hostname such as lvh.me or pages.example.com';
}

/** The development pages host: `*.lvh.me` resolves to 127.0.0.1 in public DNS, with no hosts-file edit. */
export const DEV_PAGES_HOST = 'lvh.me';

/**
 * Documents on their own origins need the app on the SAME SITE as the pages host (the frame's cookie is
 * SameSite=Lax), so a loopback public URL moves to `app.<pages host>` on the same port.
 */
function sameSitePublicUrl(publicUrl, pagesHost) {
  try {
    const url = new URL(publicUrl);
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (!pagesHost || !loopback) return publicUrl;
    url.hostname = `app.${pagesHost}`;
    return url.origin;
  } catch {
    return publicUrl;
  }
}

function s3UrlError(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol === 's3:' && url.hostname) return undefined;
  } catch {}
  return 'S3 URL must be an s3:// URL';
}

function portFromPublicUrl(publicUrl) {
  try {
    const port = new URL(publicUrl).port;
    return port ? Number(port) : 3030;
  } catch {
    return 3030;
  }
}

export function publicUrlWithPort(publicUrl, port) {
  const url = new URL(publicUrl);
  url.port = String(port);
  return url.origin;
}

function publicUrlFromPort(port) {
  return publicUrlWithPort(DEFAULT_PUBLIC_URL, port);
}

export function loopbackPublicUrlFollowsPort(publicUrl, port) {
  try {
    const url = new URL(publicUrl);
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    return loopback && Number(url.port) === Number(port);
  } catch {
    return false;
  }
}

function fromAddress(publicUrl) {
  return `artifactbin <login@${new URL(publicUrl).hostname}>`;
}

export function defaultAnswers(answerOverrides = {}) {
  const answers = {
    publicUrl: DEFAULT_PUBLIC_URL,
    port: 3030,
    email: '',
    emailFrom: '',
    database: 'pglite',
    databaseUrl: '',
    objects: 'local',
    s3Url: '',
    pagesHost: '',
    ...answerOverrides,
  };
  if (answerOverrides.port !== undefined && answerOverrides.publicUrl === undefined) {
    answers.publicUrl = publicUrlFromPort(answerOverrides.port);
  } else if (answerOverrides.publicUrl !== undefined && answerOverrides.port === undefined) {
    answers.port = portFromPublicUrl(answerOverrides.publicUrl);
  }
  answers.publicUrl = sameSitePublicUrl(answers.publicUrl, answers.pagesHost);
  return answers;
}

function activeEnv(text) {
  const values = new Map();
  for (const line of String(text).split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

/** The setup choices represented by an existing file. */
export function existingAnswers(text) {
  const values = activeEnv(text);
  const publicUrl = values.get('APP__PUBLIC_BASE_URL') || DEFAULT_PUBLIC_URL;
  const databaseUrl = values.get('DATABASE_URL') || '';
  const s3Url = values.get('S3_URL') || '';
  return defaultAnswers({
    publicUrl,
    port: values.has('APP__PORT') ? Number(values.get('APP__PORT')) : portFromPublicUrl(publicUrl),
    email: values.get('EMAIL__RESEND_API_KEY') || '',
    emailFrom: values.get('EMAIL__FROM') || '',
    database: databaseUrl ? 'postgres' : 'pglite',
    databaseUrl,
    objects: s3Url ? 's3' : 'local',
    s3Url,
    pagesHost: values.get('APP__PAGES_HOST') || '',
  });
}

export function questions() {
  return [
    { key: 'publicUrl', prompt: 'APP__PUBLIC_BASE_URL — public URL people will use', default: DEFAULT_PUBLIC_URL, validate: httpUrlError },
    { key: 'port', prompt: 'APP__PORT — local port to listen on', default: (answers) => portFromPublicUrl(answers.publicUrl), validate: portError },
    { key: 'email', prompt: 'EMAIL__RESEND_API_KEY — login email (optional)', default: '', validate: () => undefined, secret: true, clearable: true },
    { key: 'emailFrom', prompt: 'EMAIL__FROM — sender address', default: (answers) => fromAddress(answers.publicUrl), validate: (value) => String(value).trim() ? undefined : 'From address must not be blank', when: (answers) => Boolean(answers.email) },
    { key: 'database', prompt: 'DATABASE_URL — storage: [1] embedded PGLite  [2] Postgres URL', default: '1', validate: (value) => ['1', '2', 'pglite', 'postgres'].includes(String(value)) ? undefined : 'Database must be 1 or 2' },
    { key: 'databaseUrl', prompt: 'DATABASE_URL — Postgres URL', default: '', validate: postgresUrlError, secret: true, when: (answers) => answers.database === 'postgres' || answers.database === '2' },
    { key: 'objects', prompt: 'S3_URL — object storage: [1] local directory  [2] S3-compatible URL', default: '1', validate: (value) => ['1', '2', 'local', 's3'].includes(String(value)) ? undefined : 'Objects must be 1 or 2' },
    { key: 's3Url', prompt: 'S3_URL — S3-compatible URL', default: '', validate: s3UrlError, secret: true, when: (answers) => answers.objects === 's3' || answers.objects === '2' },
  ];
}

export function parseArgs(argv) {
  const result = { answers: {}, yes: false, noInterview: false, out: '.env', force: false, print: false };
  const values = new Map([
    ['--out', 'out'],
    ['--public-url', 'publicUrl'],
    ['--port', 'port'],
    ['--resend-key', 'email'],
    ['--email-from', 'emailFrom'],
    ['--database-url', 'databaseUrl'],
    ['--s3-url', 's3Url'],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--yes') result.yes = true;
    else if (flag === '--no-interview') {
      result.yes = true;
      result.noInterview = true;
    } else if (flag === '--force') result.force = true;
    else if (flag === '--print') result.print = true;
    else if (flag === '--pages-host') {
      // `--pages-host` alone is development's lvh.me; `--pages-host <host>` names one.
      const value = argv[index + 1];
      if (value !== undefined && !value.startsWith('--')) { result.answers.pagesHost = value.trim().toLowerCase(); index += 1; }
      else result.answers.pagesHost = DEV_PAGES_HOST;
    }
    else if (values.has(flag)) {
      const value = argv[index + 1];
      if (value === undefined) return { ...result, error: `${flag} requires a value` };
      index += 1;
      const key = values.get(flag);
      if (key === 'out') result.out = value;
      else result.answers[key] = key === 'port' ? Number(value) : value;
    } else return { ...result, error: `Unknown flag: ${flag}` };
  }

  if (!result.out) return { ...result, error: 'Output path must not be blank' };
  if (result.answers.publicUrl !== undefined) {
    const error = httpUrlError(result.answers.publicUrl);
    if (error) return { ...result, error };
  }
  if (result.answers.port !== undefined) {
    const error = portError(result.answers.port);
    if (error) return { ...result, error };
  }
  if (result.answers.pagesHost !== undefined) {
    const error = pagesHostError(result.answers.pagesHost);
    if (error) return { ...result, error };
  }
  if (result.answers.databaseUrl !== undefined) {
    const error = postgresUrlError(result.answers.databaseUrl);
    if (error) return { ...result, error };
    result.answers.database = 'postgres';
  }
  if (result.answers.s3Url !== undefined) {
    const error = s3UrlError(result.answers.s3Url);
    if (error) return { ...result, error };
    result.answers.objects = 's3';
  }
  return result;
}

function validateAnswers(answers) {
  const publicUrlError = httpUrlError(answers.publicUrl);
  if (publicUrlError) throw new Error(publicUrlError);
  const answerPortError = portError(answers.port);
  if (answerPortError) throw new Error(answerPortError);
  if (answers.database === 'postgres') {
    const error = postgresUrlError(answers.databaseUrl);
    if (error) throw new Error(error);
  }
  if (answers.objects === 's3') {
    const error = s3UrlError(answers.s3Url);
    if (error) throw new Error(error);
  }
}

export function buildEnvFile(answerOverrides, { generated, validate = true }) {
  const answers = defaultAnswers(answerOverrides);
  if (validate) validateAnswers(answers);
  for (const name of ['AUTH__SECRET', 'ADMIN__SECRET', 'CONTRACT__ACTOR_SECRET', 'INTERNAL__SERVICE_SECRET']) {
    if (!generated?.[name]) throw new Error(`Missing generated ${name}`);
  }

  let text = ENV_EXAMPLE
    .replace(/^ADMIN__SECRET=.*$/m, `ADMIN__SECRET=${generated.ADMIN__SECRET}`)
    .replace(/^AUTH__SECRET=.*$/m, `AUTH__SECRET=${generated.AUTH__SECRET}`)
    .replace(/^# CONTRACT__ACTOR_SECRET=.*$/m, `CONTRACT__ACTOR_SECRET=${generated.CONTRACT__ACTOR_SECRET}`)
    .replace(/^# INTERNAL__SERVICE_SECRET=.*$/m, `INTERNAL__SERVICE_SECRET=${generated.INTERNAL__SERVICE_SECRET}`)
    .replace(/^APP__PUBLIC_BASE_URL=.*$/m, `APP__PUBLIC_BASE_URL=${answers.publicUrl}`)
    .replace(/^APP__PORT=.*$/m, `APP__PORT=${answers.port}`);
  if (answers.pagesHost) text = text.replace(/^# APP__PAGES_HOST=.*$/m, `APP__PAGES_HOST=${answers.pagesHost}`);

  if (answers.database === 'postgres') {
    text = text.replace(/^# DATABASE_URL=.*$/m, `DATABASE_URL=${answers.databaseUrl}`);
  }
  if (answers.email) {
    text = text
      .replace(/^EMAIL__RESEND_API_KEY=.*$/m, `EMAIL__RESEND_API_KEY=${answers.email}`)
      .replace(/^EMAIL__FROM=.*$/m, `EMAIL__FROM=${answers.emailFrom || fromAddress(answers.publicUrl)}`);
  } else {
    text = text
      .replace(/^EMAIL__RESEND_API_KEY=.*$/m, '# EMAIL__RESEND_API_KEY=')
      .replace(/^EMAIL__FROM=.*$/m, '# EMAIL__FROM=');
  }
  if (answers.objects === 's3') {
    text = text
      .replace(/^# S3_URL=.*$/m, `S3_URL=${answers.s3Url}`)
      .replace(/^OBJECT_STORE__LOCAL_DIR=.*$/m, '# OBJECT_STORE__LOCAL_DIR=./data/objects');
  } else {
    text = text.replace(/^OBJECT_STORE__LOCAL_DIR=.*$/m, 'OBJECT_STORE__LOCAL_DIR=./data/objects');
  }
  return text.endsWith('\n') ? text : `${text}\n`;
}

const MANAGED_ENV = {
  publicUrl: ['APP__PUBLIC_BASE_URL'], port: ['APP__PORT'], pagesHost: ['APP__PAGES_HOST', 'APP__PUBLIC_BASE_URL'],
  email: ['EMAIL__RESEND_API_KEY', 'EMAIL__FROM'], emailFrom: ['EMAIL__FROM'],
  database: ['DATABASE_URL'], databaseUrl: ['DATABASE_URL'],
  objects: ['S3_URL', 'OBJECT_STORE__LOCAL_DIR'], s3Url: ['S3_URL', 'OBJECT_STORE__LOCAL_DIR'],
};

function replaceEnvLine(text, name, value) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^#?[ \\t]*${escaped}=.*$`, 'm');
  if (pattern.test(text)) return text.replace(pattern, `${name}=${value}`);
  return `${text.trimEnd()}\n${name}=${value}\n`;
}

/**
 * Rebuild against the current example while retaining every configured value.
 * Only choices explicitly supplied by the caller replace existing values.
 */
export function mergeEnvFile(existingText, answerOverrides, { generated, supplied = new Set(Object.keys(answerOverrides)) }) {
  const current = activeEnv(existingText);
  const prior = existingAnswers(existingText);
  const effectiveSupplied = new Set(supplied);
  const explicit = Object.fromEntries([...effectiveSupplied].filter((key) => key in answerOverrides).map((key) => [key, answerOverrides[key]]));
  if (effectiveSupplied.has('port') && !effectiveSupplied.has('publicUrl') && loopbackPublicUrlFollowsPort(prior.publicUrl, prior.port)) {
    explicit.publicUrl = publicUrlWithPort(prior.publicUrl, answerOverrides.port);
    effectiveSupplied.add('publicUrl');
  }
  const answers = defaultAnswers({ ...prior, ...explicit });
  const secrets = { ...generated };
  for (const name of ['AUTH__SECRET', 'ADMIN__SECRET', 'CONTRACT__ACTOR_SECRET', 'INTERNAL__SERVICE_SECRET']) {
    if (current.get(name)) secrets[name] = current.get(name);
  }
  // Explicit replacements were validated at the CLI/interview boundary.
  // Existing values are preserved verbatim, even when the editor would not
  // create them (for example a driver-specific connection-string spelling).
  let text = buildEnvFile(answers, { generated: secrets, validate: false });
  const replaced = new Set([...effectiveSupplied].flatMap((key) => MANAGED_ENV[key] ?? []));
  for (const [name, value] of current) {
    if (!replaced.has(name)) text = replaceEnvLine(text, name, value);
  }
  return text.endsWith('\n') ? text : `${text}\n`;
}
