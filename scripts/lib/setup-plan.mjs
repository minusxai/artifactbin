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
const ENV_EXAMPLE_BASE64 = 'IyBSdW4gYG5wbSBydW4gc2V0dXBgIHRvIGdlbmVyYXRlIGEgc2VjdXJlIGAuZW52YCBmb3IgdGhpcyBjaGVja291dC4KCiMgRW5hYmxlcyBvcGVyYXRpb25hbCB0b2tlbiBtaW50L3Jldm9rZSBlbmRwb2ludHMuIEdlbmVyYXRlIHdpdGg6IG9wZW5zc2wgcmFuZCAtYmFzZTY0IDMyCkFETUlOX19TRUNSRVQ9CgojIFNpZ25zIGxvZ2luIHNlc3Npb25zLiBHZW5lcmF0ZSB3aXRoOiBvcGVuc3NsIHJhbmQgLWJhc2U2NCAzMgpBVVRIX19TRUNSRVQ9CgojIFVuc2V0IHVzZXMgZW1iZWRkZWQgUEdMaXRlIGF0IC4vZGF0YS9wZ2xpdGUuIEFsc28gYWNjZXB0cyBwZ2xpdGU6Ly9tZW1vcnkgb3IgUG9zdGdyZXMuCiMgREFUQUJBU0VfVVJMPXBnbGl0ZTovLy4vZGF0YS9wZ2xpdGUKCiMgUHVibGljIG9yaWdpbiBhbmQgbGlzdGVuaW5nIHBvcnQuIEFQUF9fSE1SX1BPUlQgZGVmYXVsdHMgdG8gQVBQX19QT1JUICsgMS4KQVBQX19QVUJMSUNfQkFTRV9VUkw9aHR0cDovL2xvY2FsaG9zdDozMDMwCiMgT3B0aW9uYWwgZGVkaWNhdGVkIG9yaWdpbiB0aGF0IHNlcnZlcyBvbmx5IGFub255bW91cyBjYWNoZWQgYnl0ZXMgYXQgL2Fzc2V0cy8qLgojIFByb2R1Y3Rpb24gcmVxdWlyZXMgYSBkaXN0aW5jdCBIVFRQUyBob3N0bmFtZTsgSFRUUCBpcyBhY2NlcHRlZCBvbmx5IG9uIGxvb3BiYWNrLgojIEFQUF9fQVNTRVRTX09SSUdJTj1odHRwczovL2Fzc2V0cy5leGFtcGxlLmNvbQojIE90aGVyIG9yaWdpbnMgdGhpcyBzYW1lIGRlcGxveW1lbnQgYW5zd2VycyBhdCAoYSBtYXJrZXRpbmcgaG9zdG5hbWUgdGhhdCBwcm94aWVzCiMgaGVyZSwgYSBwcmV2aW91cyBuYW1lKS4gQ29tbWEtc2VwYXJhdGVkOyBIVFRQUywgb3IgSFRUUCBvbiBsb29wYmFjazsgbm8gcGF0aCBvcgojIGNyZWRlbnRpYWxzLiBTZXJ2ZWQgYXQgR0VUIC9hcGkvc2VydmVyLCBzbyBhZmJpbiB0cmVhdHMgYSBsaW5rIG9yIGEgZm9sZGVyIGZyb20KIyBlaXRoZXIgbmFtZSBhcyB0aGlzIHNlcnZlcjsgcmVxdWVzdHMgYW5kIGNyZWRlbnRpYWxzIHN0aWxsIGdvIHRvCiMgQVBQX19QVUJMSUNfQkFTRV9VUkwgYWxvbmUuIEEgbWFsZm9ybWVkIGVudHJ5IHJlZnVzZXMgdGhlIGJvb3QuCiMgQVBQX19BTElBU19PUklHSU5TPWh0dHBzOi8vZXhhbXBsZS5jb20KQVBQX19QT1JUPTMwMzAKIyBBUFBfX0hPU1Q9CkFQUF9fSE1SX1BPUlQ9CgojIFBlci10b2tlbiBhcnRpZmFjdCBjYXA7IDAgZGlzYWJsZXMgdGhlIGNhcC4KUVVPVEFfX0FSVElGQUNUU19QRVJfVE9LRU49MTAwMAoKIyBTdG9yZWQgYXNzZXRzIHBlciBhY2NvdW50ICh1cGxvYWRzICsgVVJMcyBpbXBvcnRlZCBmaXJzdCksIDEwIEdCOyBhbm9ueW1vdXMgdG9rZW5zIGhhdmUgdGhlaXIgb3duIGNhcC4gMCBkaXNhYmxlcy4KIyBBU1NFVFNfX01BWF9CWVRFU19QRVJfVE9LRU49MTAwMDAwMDAwMDAKCiMgTG9jYWwgZGV2ZWxvcG1lbnQgd3JpdGVzIGxvZ2luIG1haWwgdG8gLmFydGlmYWN0YmluL2Rldi1tYWlsLmpzb25sOyByZWFkIGEgY29kZSB3aXRoOgojICAgbnBtIHJ1biBkZXY6b3RwIC0tIHlvdUBleGFtcGxlLmNvbQojIE9wdGlvbmFsIG92ZXJyaWRlIGZvciBzdGFuZGFsb25lIHByb2Nlc3NlcyBhbmQgdGVzdCBvcmNoZXN0cmF0aW9uLgojIEVNQUlMX19ERVZfT1VUQk9YX1BBVEg9CiMgUHVibGljIGRlcGxveW1lbnRzIHJlcXVpcmUgYSBSZXNlbmQga2V5IGFuZCB2ZXJpZmllZCBzZW5kZXIuCkVNQUlMX19SRVNFTkRfQVBJX0tFWT0KRU1BSUxfX0ZST009YXJ0aWZhY3RiaW4gPGxvZ2luQGV4YW1wbGUuY29tPgoKIyBVbnNldCBTM19VUkwgc3RvcmVzIG9iamVjdHMgbG9jYWxseS4gUGVyY2VudC1lbmNvZGUgY3JlZGVudGlhbHMgaW4gUzMgVVJMcy4KIyBTM19VUkw9czM6Ly9LRVk6U0VDUkVUQHMzLnJlZ2lvbi5hbWF6b25hd3MuY29tL2J1Y2tldC9wcmVmaXg/cmVnaW9uPXJlZ2lvbgpPQkpFQ1RfU1RPUkVfX0xPQ0FMX0RJUj0uYXJ0aWZhY3Qtb2JqZWN0cwoKSU1BR0VTX19NQVhfQllURVM9NTAwMDAwMDAKUERGX19NQVhfQllURVM9NTAwMDAwMDAKRklMRVNfX01BWF9CWVRFUz01MDAwMDAwMAoKIyBXZWIgaW1wb3J0cyBibG9jayBwcml2YXRlIG5ldHdvcmtzIGJ5IGRlZmF1bHQuCldFQl9JTkdFU1RfX0FMTE9XX1BSSVZBVEU9MApXRUJfSU5HRVNUX19USU1FT1VUX01TPTEwMDAwCldFQl9JTkdFU1RfX01BWF9QRVJfSE9VUj0zMDAKV0VCX0lOR0VTVF9fTUFYX0lNQUdFU19QRVJfUFVCTElTSD04CldFQl9JTkdFU1RfX01BWF9BU1NFVFNfUEVSX1BVQkxJU0g9MTYKClNRTF9fTUFYX1JPV1M9MTAwMDAKU1FMX19NQVhfUVVFUllfUk9XUz0xMDAwMApTUUxfX1FVRVJZX1RJTUVPVVRfTVM9NTAwMAoKIyBOdW1iZXIgb2YgdHJ1c3RlZCBmb3J3YXJkaW5nIGhvcHMgdXNlZCB0byBpbnRlcnByZXQgY2xpZW50IGFkZHJlc3Nlcy4KSFRUUF9fVFJVU1RFRF9QUk9YWV9IT1BTPTEKCiMgT3B0aW9uYWwgZGVwbG95bWVudCBjb250cm9scy4KIyBBUlRJRkFDVFNfX0FMTE9XX1BVQkxJQz0xCiMgQ3VzdG9tIGRvbWFpbnMgZm9yIHByb2ZpbGVzOiB0aGUgRE5TIHRhcmdldCBob3N0bmFtZSB1c2VycyBwb2ludCB0aGVpciBkb21haW4gYXQKIyAoYSBDTkFNRS9BTElBUyB0byBpdCwgb3IgYW4gQSByZWNvcmQgdG8gaXRzIGFkZHJlc3MpLiBVbnNldCBvciBlbXB0eSB0dXJucyBvZmYKIyBhdHRhY2hpbmcgYW5kIHZlcmlmeWluZyBvbmx5OyB2ZXJpZmllZCBkb21haW5zIGtlZXAgYmVpbmcgc2VydmVkIGVpdGhlciB3YXkuCiMgRkxBR19fQ1VTVE9NX0RPTUFJTlM9ZG9tYWlucy5leGFtcGxlLmNvbQojIFRoZSBjb21waWxlZCBkb2N1bWVudCByZWFkZXIgKGRvY3MvcGhhc2UyLWFyY2hpdGVjdHVyZS5tZCk6IG9mZiA9IHRvZGF5J3MgcmVuZGVyZXI7CiMgc2hhZG93ID0gY29tcGlsZSBhbmQgc3RvcmUgZXZlcnkgdmVyc2lvbiwgc2VydmUgaXQgb25seSB0byBgP3JlYWRlcj1jb21waWxlZGA7CiMgb24gPSBzZXJ2ZSBjb21waWxlZCBwYWdlcywgYD9yZWFkZXI9bGVnYWN5YCBlc2NhcGVzLiBBbnl0aGluZyBlbHNlIHJlYWRzIGFzIG9mZi4KIyBGTEFHX19DT01QSUxFRF9SRUFERVI9b2ZmCiMgQU5BTFlUSUNTX19TRUNSRVQ9CgojIFNwbGl0LXNlcnZpY2UgZGVwbG95bWVudC4gSU5URVJOQUxfX1NFUlZJQ0VfU0VDUkVUIG11c3QgbWF0Y2ggYWNyb3NzIGFwcCwgU1FMLCBicm93c2VyIGFuZCBldmVudHMuCiMgQ09OVFJBQ1RfX0FDVE9SX1NFQ1JFVD0KIyBCUk9XU0VSX19TRVJWSUNFX1VSTD1odHRwOi8vYnJvd3Nlcjo4MDgwCiMgT3B0aW9uYWwgZGlyZWN0IGV4cG9ydCB1cGxvYWQ7IGV4YWN0IFMzIG9yaWdpbiBhbmQgZXhwb3J0IG9iamVjdCBwcmVmaXggb25seS4KIyBCUk9XU0VSX19VUExPQURfT1JJR0lOPWh0dHBzOi8vYnVja2V0LnMzLnVzLXdlc3QtMS5hbWF6b25hd3MuY29tCiMgQlJPV1NFUl9fVVBMT0FEX1BSRUZJWD0vYXJ0aWZhY3RzL2V4cG9ydHMvb2JqZWN0cy8KIyBJbnRlcm5hbC1vbmx5IGJyb3dzZXJzIHJlYWNoIFMzIHRocm91Z2ggdGhlIHNjb3BlZCB1cGxvYWQgZ2F0ZXdheS4KIyBCUk9XU0VSX19VUExPQURfUFJPWFlfVVJMPWh0dHA6Ly91cGxvYWQtZ2F0ZXdheTo4MDgwCiMgQnJvd3NlciBzZXNzaW9ucyByZXF1aXJlIExpbnV4IGJ1YmJsZXdyYXAgd2l0aCB1bnByaXZpbGVnZWQgdXNlciBuYW1lc3BhY2VzLgojIERFVkVMT1BNRU5UIE9OTFkuIEJST1dTRVJfX1NBTkRCT1g9bm9uZSBydW5zIHRoZSBzZXNzaW9uIHdvcmtlciBhcyBhIHBsYWluIGNoaWxkCiMgcHJvY2Vzczogbm8gYnViYmxld3JhcCwgbm8gY2dyb3VwLCBOTyBPUyBjb250YWlubWVudCDigJQgYSBzZXNzaW9uIHNjcmlwdCB0aGVuIGhhcyB0aGUKIyB3aG9sZSBtYWNoaW5lLCB0aGlzIGNoZWNrb3V0IGFuZCB0aGUgbmV0d29yay4gSXQgZXhpc3RzIHNvIGxpdmUgc2Vzc2lvbnMgcnVuIG9uIGEKIyBtYWNPUyBkZXYgaG9zdCBhdCBhbGw7IGBucG0gcnVuIGRldmAgYWxyZWFkeSBkZWZhdWx0cyBpdCB0aGVyZS4gSXQgaXMgcmVmdXNlZCB3aGVuCiMgTk9ERV9FTlY9cHJvZHVjdGlvbiwgYW5kIGFueSBvdGhlciB2YWx1ZSBpcyByZWZ1c2VkIG91dHJpZ2h0LiBOZXZlciBzZXQgaXQgb24gYSBzZXJ2ZXIuCiMgQlJPV1NFUl9fU0FOREJPWD1ub25lCiMgU3BsaXQgYnJvd3NlciBzZXJ2aWNlOiB0cnVzdGVkIGFwcCBVUkw7IGFsc28gc2V0IEFQUF9fUFVCTElDX0JBU0VfVVJMIGFuZCBDT05UUkFDVF9fQUNUT1JfU0VDUkVUIHRoZXJlLgojIEJST1dTRVJfX1NFU1NJT05fQVBQX1VSTD1odHRwOi8vYXBwOjgwODAKIyBXcml0YWJsZSBkZWxlZ2F0ZWQgY2dyb3VwIHYyIHN1YnRyZWUgd2l0aCBjcHUsIG1lbW9yeSBhbmQgcGlkcyBjb250cm9sbGVycyBlbmFibGVkLgojIEJST1dTRVJfX1NFU1NJT05fQ0dST1VQX1JPT1Q9L3N5cy9mcy9jZ3JvdXAvYWZiaW4tc2Vzc2lvbnMKIyBMaXZlIGJyb3dzZXIgc2Vzc2lvbnMgdGhpcyBzZXJ2aWNlIGhvbGRzLCBzaGFyZWQgYnkgZXZlcnkgb3duZXIsIGFuZCBob3cgbWFueSBvbmUKIyBjcmVkZW50aWFsIG1heSBob2xkLiBXaG9sZSBudW1iZXJzIG9mIGF0IGxlYXN0IDE7IGVhY2ggc2Vzc2lvbiBzdGlsbCBnZXRzIDEgR2lCLgojIEJST1dTRVJfX1NFU1NJT05fTUFYPTIKIyBCUk9XU0VSX19TRVNTSU9OX01BWF9QRVJfQUNUT1I9MgojIElOVEVSTkFMX19TRVJWSUNFX1NFQ1JFVD0KIyBTUUxfX1NFUlZJQ0VfVVJMPWh0dHA6Ly9zcWw6ODA4MAojIEV2ZW50cyB1c2UgdGhlIGxvY2FsIGRhdGFiYXNlIHVubGVzcyBhbiBIVFRQIHNlcnZpY2UgVVJMIGlzIGNvbmZpZ3VyZWQuCiMgRVZFTlRTX19TRVJWSUNFX1VSTD1odHRwOi8vZXZlbnRzOjgwODAKIyBFVkVOVFNfX1NDSEVNQT1ldmVudHMKRVhQT1JUX19JTlRFUk5BTF9PUklHSU49CgojIE9wdGlvbmFsIGRhdGFiYXNlIHNjaGVtYSBuYW1lcy4KIyBBVVRIX19TQ0hFTUE9YXV0aAojIEFQUF9fU0NIRU1BPWFwcAoKIyBPcHRpb25hbCBHb29nbGUgbG9naW4uCiMgQVVUSF9fR09PR0xFX0NMSUVOVF9JRD0KIyBBVVRIX19HT09HTEVfQ0xJRU5UX1NFQ1JFVD0KCiMgT3B0aW9uYWwgT0lEQyBsb2dpbi4gVXNlIGV4cGxpY2l0IGVuZHBvaW50cyBvciBkaXNjb3ZlcnksIG5vdCBib3RoLgojIEFVVEhfX09JRENfUFJPVklERVJfSUQ9b2lkYwojIEFVVEhfX09JRENfQ0xJRU5UX0lEPQojIEFVVEhfX09JRENfQ0xJRU5UX1NFQ1JFVD0KIyBBVVRIX19PSURDX0FVVEhPUklaQVRJT05fVVJMPQojIEFVVEhfX09JRENfVE9LRU5fVVJMPQojIEFVVEhfX09JRENfVVNFUklORk9fVVJMPQojIEFVVEhfX09JRENfRElTQ09WRVJZX1VSTD0KCgojIFBlcm1pdCBQb3N0Z3JlcyBjb25uZWN0aW9ucyB0byBsb29wYmFjay9wcml2YXRlIG5ldHdvcmtzIChzZWxmLWhvc3RlZCBkZXBsb3ltZW50cyBvbmx5KS4KIyBMaW5rLWxvY2FsLCBtZXRhZGF0YSwgbXVsdGljYXN0IGFuZCB1bnNwZWNpZmllZCBkZXN0aW5hdGlvbnMgcmVtYWluIGJsb2NrZWQuCkRBVEFTRVRfX0FMTE9XX1BSSVZBVEVfTkVUV09SS1M9ZmFsc2UKIyBPcHRpb25hbCBjb21tYS1zZXBhcmF0ZWQgbGl0ZXJhbCBETlMgc2VydmVyIElQcyBmb3IgZGF0YXNldCBQb3N0Z3JlU1FMIGhvc3QgcmVzb2x1dGlvbiBvbmx5LgojIEVtcHR5IHVzZXMgdGhlIG9wZXJhdGluZyBzeXN0ZW0gcmVzb2x2ZXIuCkRBVEFTRVRfX0ROU19TRVJWRVJTPQoKIyBDTEktb25seSBzZXJ2aWNlIG1pcnJvcjogZXhwb3J0IHRoaXMgaW4gdGhlIHNoZWxsIHJ1bm5pbmcgYWZiaW47IGNoZWNrc3VtcyByZW1haW4gcGlubmVkLgojIEFuIEhUVFBTIGJhc2UgVVJMIChvcHRpb25hbCBwYXRoIHByZWZpeCksIG9yIEhUVFAgbG9vcGJhY2s7IHNlcnZlcyBhZmJpbi12VkVSU0lPTi9hZmJpbi1zcWwtT1MtQVJDSC5nei4KIyBDTElfX1NFUlZJQ0VfQkFTRV9VUkw9CgojIENMSS1vbmx5OiBleHBvcnRlZCBzZXR0aW5ncyBmb3IgbWFuYWdlZCBzdGFuZGFsb25lIGJhY2tncm91bmQgdXBkYXRlcy4KIyBTZXQgdG8gMCB0byBkaXNhYmxlIGF1dG9tYXRpYyBkaXNjb3ZlcnkgYW5kIGluc3RhbGxhdGlvbiAoZXhwbGljaXQgYWZiaW4gdXBkYXRlIHN0aWxsIHdvcmtzKS4KIyBDTElfX0FVVE9fVVBEQVRFPTEKIyBBIHZlcnNpb24gcGluIGRpc2FibGVzIGF1dG9tYXRpYyB1cGRhdGVzIGFuZCByZXN0cmljdHMgZXhwbGljaXQgdXBkYXRlcyB0byB0aGF0IHJlbGVhc2UuCiMgQ0xJX19WRVJTSU9OX1BJTj0K';
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
    ...answerOverrides,
  };
  if (answerOverrides.port !== undefined && answerOverrides.publicUrl === undefined) {
    answers.publicUrl = publicUrlFromPort(answerOverrides.port);
  } else if (answerOverrides.publicUrl !== undefined && answerOverrides.port === undefined) {
    answers.port = portFromPublicUrl(answerOverrides.publicUrl);
  }
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
  publicUrl: ['APP__PUBLIC_BASE_URL'], port: ['APP__PORT'],
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
