/**
 * Pure setup planning: the questions, CLI contract, validation, and rendered
 * environment file. The runner owns every side effect.
 *
 * The example is snapshotted because the runtime image deliberately contains
 * only the two setup modules; decoding this constant is deterministic and
 * keeps this module free of filesystem I/O. The snapshot is GENERATED —
 * `npm run generate:env-snapshot` writes it from `.env.example`, and
 * `scripts/__tests__/setup-plan.test.mjs` fails when the two have drifted.
 */

const DEFAULT_PUBLIC_URL = 'http://localhost:3030';

// Generated from .env.example — do not hand-edit; run `npm run generate:env-snapshot`.
const ENV_EXAMPLE_BASE64 = 'IyBSdW4gYG5wbSBydW4gc2V0dXBgIHRvIGdlbmVyYXRlIGEgc2VjdXJlIGAuZW52YCBmb3IgdGhpcyBjaGVja291dC4KCiMgT3B0aW9uYWwgbW9kZWwgY29ubmVjdGlvbnMuIE9uZSBlbnRyeSBwZXIgbW9kZWwsIG5vdCBwZXIgcHJvbXB0IG9yIHVzZSBjYXNlLgojIEV4YW1wbGU6IHsiZGVmYXVsdCI6eyJhcGkiOiJvcGVuYWktY29tcGxldGlvbnMiLCJiYXNlVXJsIjoiaHR0cHM6Ly9hcGkuZmlyZXdvcmtzLmFpL2luZmVyZW5jZS92MSIsIm1vZGVsIjoieW91ci1tb2RlbC1pZCIsImFwaUtleUVudiI6IkdFTkVSQVRJT05fX0ZJUkVXT1JLU19BUElfS0VZIn19CkdFTkVSQVRJT05fX01PREVMUz0KIyBPcGVyYXRvci1hcHByb3ZlZCBkYXRhc2V0IGdlbmVyYXRpb24gcG9vbHM6IHsiREFUQVNFVElEIjp7Im1vZGVscyI6WyJkZWZhdWx0Il0sImNhbGxzUGVyRGF5IjoxMDAsIm1heFRva2VucyI6MTAyNH19CkdFTkVSQVRJT05fX1BVQkxJQ19QT09MUz0KIyBHRU5FUkFUSU9OX19GSVJFV09SS1NfQVBJX0tFWT0KCiMgRW5hYmxlcyBvcGVyYXRpb25hbCB0b2tlbiBtaW50L3Jldm9rZSBlbmRwb2ludHMuIEdlbmVyYXRlIHdpdGg6IG9wZW5zc2wgcmFuZCAtYmFzZTY0IDMyCkFETUlOX19TRUNSRVQ9CiMgT3B0aW9uYWwgdmVyaWZpZWQgZW1haWxzIGZvciBleHBsaWNpdCBkb2N1bWVudCByZXBhaXI7IGVtcHR5IGRpc2FibGVzIGFkbWluIGFjY2Vzcy4KQURNSU5fX0VNQUlMUz0KCiMgU2lnbnMgbG9naW4gc2Vzc2lvbnMuIEdlbmVyYXRlIHdpdGg6IG9wZW5zc2wgcmFuZCAtYmFzZTY0IDMyCkFVVEhfX1NFQ1JFVD0KCiMgVW5zZXQgdXNlcyBlbWJlZGRlZCBQR0xpdGUgYXQgLi9kYXRhL3BnbGl0ZS4gQWxzbyBhY2NlcHRzIHBnbGl0ZTovL21lbW9yeSBvciBQb3N0Z3Jlcy4KIyBEQVRBQkFTRV9VUkw9cGdsaXRlOi8vLi9kYXRhL3BnbGl0ZQoKIyBQdWJsaWMgb3JpZ2luIGFuZCBsaXN0ZW5pbmcgcG9ydC4gQVBQX19ITVJfUE9SVCBkZWZhdWx0cyB0byBBUFBfX1BPUlQgKyAxLgpBUFBfX1BVQkxJQ19CQVNFX1VSTD1odHRwOi8vbG9jYWxob3N0OjMwMzAKIyBPcHRpb25hbCBkZWRpY2F0ZWQgb3JpZ2luIHRoYXQgc2VydmVzIG9ubHkgYW5vbnltb3VzIGNhY2hlZCBieXRlcyBhdCAvYXNzZXRzLyouCiMgUHJvZHVjdGlvbiByZXF1aXJlcyBhIGRpc3RpbmN0IEhUVFBTIGhvc3RuYW1lOyBIVFRQIGlzIGFjY2VwdGVkIG9ubHkgb24gbG9vcGJhY2suCiMgQVBQX19BU1NFVFNfT1JJR0lOPWh0dHBzOi8vYXNzZXRzLmV4YW1wbGUuY29tCkFQUF9fUE9SVD0zMDMwCiMgQVBQX19IT1NUPQpBUFBfX0hNUl9QT1JUPQoKIyBQZXItdG9rZW4gYXJ0aWZhY3QgY2FwOyAwIGRpc2FibGVzIHRoZSBjYXAuClFVT1RBX19BUlRJRkFDVFNfUEVSX1RPS0VOPTEwMDAKCiMgU3RvcmVkIGJ5dGVzIG9uZSBpbXBvcnRlciBtYXkgY2F1c2UgKHVwbG9hZHMgKyB0aGUgVVJMcyBpdCBpbXBvcnRlZCBmaXJzdCk7IDAgZGlzYWJsZXMuCiMgQVNTRVRTX19NQVhfQllURVNfUEVSX1RPS0VOPTUzNjg3MDkxMgoKIyBMb2NhbCBkZXZlbG9wbWVudCB3cml0ZXMgbG9naW4gbWFpbCB0byAuYXJ0aWZhY3RiaW4vZGV2LW1haWwuanNvbmw7IHJlYWQgYSBjb2RlIHdpdGg6CiMgICBucG0gcnVuIGRldjpvdHAgLS0geW91QGV4YW1wbGUuY29tCiMgT3B0aW9uYWwgb3ZlcnJpZGUgZm9yIHN0YW5kYWxvbmUgcHJvY2Vzc2VzIGFuZCB0ZXN0IG9yY2hlc3RyYXRpb24uCiMgRU1BSUxfX0RFVl9PVVRCT1hfUEFUSD0KIyBQdWJsaWMgZGVwbG95bWVudHMgcmVxdWlyZSBhIFJlc2VuZCBrZXkgYW5kIHZlcmlmaWVkIHNlbmRlci4KRU1BSUxfX1JFU0VORF9BUElfS0VZPQpFTUFJTF9fRlJPTT1hcnRpZmFjdGJpbiA8bG9naW5AZXhhbXBsZS5jb20+CgojIFVuc2V0IFMzX1VSTCBzdG9yZXMgb2JqZWN0cyBsb2NhbGx5LiBQZXJjZW50LWVuY29kZSBjcmVkZW50aWFscyBpbiBTMyBVUkxzLgojIFMzX1VSTD1zMzovL0tFWTpTRUNSRVRAczMucmVnaW9uLmFtYXpvbmF3cy5jb20vYnVja2V0L3ByZWZpeD9yZWdpb249cmVnaW9uCk9CSkVDVF9TVE9SRV9fTE9DQUxfRElSPS5hcnRpZmFjdC1vYmplY3RzCgpJTUFHRVNfX01BWF9CWVRFUz01MDAwMDAwClBERl9fTUFYX0JZVEVTPTI1MDAwMDAwCkZJTEVTX19NQVhfQllURVM9NTAwMDAwMDAKCiMgV2ViIGltcG9ydHMgYmxvY2sgcHJpdmF0ZSBuZXR3b3JrcyBieSBkZWZhdWx0LgpXRUJfSU5HRVNUX19BTExPV19QUklWQVRFPTAKV0VCX0lOR0VTVF9fVElNRU9VVF9NUz0xMDAwMApXRUJfSU5HRVNUX19NQVhfUEVSX0hPVVI9MzAwCldFQl9JTkdFU1RfX01BWF9JTUFHRVNfUEVSX1BVQkxJU0g9OApXRUJfSU5HRVNUX19NQVhfQVNTRVRTX1BFUl9QVUJMSVNIPTE2CgpTUUxfX01BWF9ST1dTPTEwMDAwClNRTF9fTUFYX1FVRVJZX1JPV1M9MTAwMDAKU1FMX19RVUVSWV9USU1FT1VUX01TPTUwMDAKCiMgRVZFUlkgUkFURS1MSU1JVCBOVU1CRVIgTElWRVMgSU4gQSBQT0xJQ1kgRklMRSwgbm90IGluIGFuIGVudiBuYW1lLiBUaHJlZSBzaGlwOgojICAgc2VydmljZXMvcHJveHkvZGVmYXVsdF9yYXRlX2xpbWl0cy55bWwgICB0aGUgc3RhcnRfZG9jIGRvb3IgQ0xPU0VEICgwKSDigJQgdGhlIHByb2R1Y3Rpb24gZGVmYXVsdAojICAgc2VydmljZXMvcHJveHkvc2VsZmhvc3RfcmF0ZV9saW1pdHMueW1sICB0aGUgc3RhcnRfZG9jIGRvb3IgYXQgMTAvaG91ci9pcCDigJQgdGhpcyBvbmUKIyAgIHNlcnZpY2VzL3Byb3h5L2Rldl9yYXRlX2xpbWl0cy55bWwgICAgICAgd2lkZSBvcGVuICgyMDAwKSwgc28gYSBnYXRlIHJ1biBjYW5ub3QgZXhoYXVzdCBpdAojIENvcHkgb25lIGFuZCBlZGl0IGl0IHRvIGNoYW5nZSBhIGJ1ZGdldCBvciBhZGQgYSByb3V0ZTsgdW5zZXQgbWVhbnMgdGhlIGNsb3NlZCBkZWZhdWx0LgpQUk9YWV9fUkFURV9MSU1JVF9DT05GSUdfRklMRT1zZXJ2aWNlcy9wcm94eS9zZWxmaG9zdF9yYXRlX2xpbWl0cy55bWwKUkFURV9MSU1JVEVSX19UUlVTVEVEX1BST1hZX0hPUFM9MQoKIyBPcHRpb25hbCBkZXBsb3ltZW50IGNvbnRyb2xzLgojIEFSVElGQUNUU19fQUxMT1dfUFVCTElDPTEKIyBBTkFMWVRJQ1NfX1NFQ1JFVD0KCiMgU3BsaXQtc2VydmljZSBkZXBsb3ltZW50LiBJTlRFUk5BTF9fU0VSVklDRV9TRUNSRVQgbXVzdCBtYXRjaCBhY3Jvc3MgYXBwLCBTUUwsIGJyb3dzZXIgYW5kIGV2ZW50cy4KIyBBUFBfX1VQU1RSRUFNX1VSTD1odHRwOi8vYXBwOjMwMDAKIyBDT05UUkFDVF9fQUNUT1JfU0VDUkVUPQojIEJST1dTRVJfX1NFUlZJQ0VfVVJMPWh0dHA6Ly9icm93c2VyOjgwODAKIyBCcm93c2VyIHNlc3Npb25zIHJlcXVpcmUgTGludXggYnViYmxld3JhcCB3aXRoIHVucHJpdmlsZWdlZCB1c2VyIG5hbWVzcGFjZXMuCiMgU3BsaXQgYnJvd3NlciBzZXJ2aWNlOiB0cnVzdGVkIGFwcCBVUkw7IGFsc28gc2V0IEFQUF9fUFVCTElDX0JBU0VfVVJMIGFuZCBDT05UUkFDVF9fQUNUT1JfU0VDUkVUIHRoZXJlLgojIEJST1dTRVJfX1NFU1NJT05fQVBQX1VSTD1odHRwOi8vYXBwOjgwODAKIyBXcml0YWJsZSBkZWxlZ2F0ZWQgY2dyb3VwIHYyIHN1YnRyZWUgd2l0aCBjcHUsIG1lbW9yeSBhbmQgcGlkcyBjb250cm9sbGVycyBlbmFibGVkLgojIEJST1dTRVJfX1NFU1NJT05fQ0dST1VQX1JPT1Q9L3N5cy9mcy9jZ3JvdXAvYWZiaW4tc2Vzc2lvbnMKIyBJTlRFUk5BTF9fU0VSVklDRV9TRUNSRVQ9CiMgU1FMX19TRVJWSUNFX1VSTD1odHRwOi8vc3FsOjgwODAKIyBUaGUgZXZlbnRzIHNlcnZpY2UgKHNlcnZpY2VzL2V2ZW50cyk6IHVuc2V0LCBub3RoaW5nIGxlYXZlcyB0aGUgYm94IGFuZCB0aGUgZmVlZCByZWFkcyBlbXB0eS4KIyBFVkVOVFNfX1NFUlZJQ0VfVVJMPWh0dHA6Ly9ldmVudHM6ODA4MAojIEVWRU5UU19fU0NIRU1BPWV2ZW50cwpFWFBPUlRfX0lOVEVSTkFMX09SSUdJTj0KCiMgU3RhbmRhbG9uZSBwcm94eSBkYXRhYmFzZSBzY2hlbWFzIGFuZCBmb3J3YXJkaW5nIGJlaGF2aW9yLgojIEFVVEhfX1NDSEVNQT1hdXRoCiMgQVBQX19TQ0hFTUE9YXBwCiMgUFJPWFlfX1NFQ1VSRV9DT09LSUVTPQojIFVQU1RSRUFNX19ERUFETElORV9NUz0zMDAwMAoKIyBPcHRpb25hbCBHb29nbGUgbG9naW4uCiMgQVVUSF9fR09PR0xFX0NMSUVOVF9JRD0KIyBBVVRIX19HT09HTEVfQ0xJRU5UX1NFQ1JFVD0KCiMgT3B0aW9uYWwgT0lEQyBsb2dpbi4gVXNlIGV4cGxpY2l0IGVuZHBvaW50cyBvciBkaXNjb3ZlcnksIG5vdCBib3RoLgojIEFVVEhfX09JRENfUFJPVklERVJfSUQ9b2lkYwojIEFVVEhfX09JRENfQ0xJRU5UX0lEPQojIEFVVEhfX09JRENfQ0xJRU5UX1NFQ1JFVD0KIyBBVVRIX19PSURDX0FVVEhPUklaQVRJT05fVVJMPQojIEFVVEhfX09JRENfVE9LRU5fVVJMPQojIEFVVEhfX09JRENfVVNFUklORk9fVVJMPQojIEFVVEhfX09JRENfRElTQ09WRVJZX1VSTD0KCgojIFBlcm1pdCBQb3N0Z3JlcyBjb25uZWN0aW9ucyB0byBsb29wYmFjay9wcml2YXRlIG5ldHdvcmtzIChzZWxmLWhvc3RlZCBkZXBsb3ltZW50cyBvbmx5KS4KIyBMaW5rLWxvY2FsLCBtZXRhZGF0YSwgbXVsdGljYXN0IGFuZCB1bnNwZWNpZmllZCBkZXN0aW5hdGlvbnMgcmVtYWluIGJsb2NrZWQuCkRBVEFTRVRfX0FMTE9XX1BSSVZBVEVfTkVUV09SS1M9ZmFsc2UKIyBPcHRpb25hbCBjb21tYS1zZXBhcmF0ZWQgbGl0ZXJhbCBETlMgc2VydmVyIElQcyBmb3IgZGF0YXNldCBQb3N0Z3JlU1FMIGhvc3QgcmVzb2x1dGlvbiBvbmx5LgojIEVtcHR5IHVzZXMgdGhlIG9wZXJhdGluZyBzeXN0ZW0gcmVzb2x2ZXIuCkRBVEFTRVRfX0ROU19TRVJWRVJTPQoKIyBDTEktb25seSBzZXJ2aWNlIG1pcnJvcjogZXhwb3J0IHRoaXMgaW4gdGhlIHNoZWxsIHJ1bm5pbmcgYWZiaW47IGNoZWNrc3VtcyByZW1haW4gcGlubmVkLgojIEFuIEhUVFBTIGJhc2UgVVJMIChvcHRpb25hbCBwYXRoIHByZWZpeCksIG9yIEhUVFAgbG9vcGJhY2s7IHNlcnZlcyBhZmJpbi12VkVSU0lPTi9hZmJpbi1zcWwtT1MtQVJDSC5nei4KIyBDTElfX1NFUlZJQ0VfQkFTRV9VUkw9CgojIENMSS1vbmx5OiBleHBvcnRlZCBzZXR0aW5ncyBmb3IgbWFuYWdlZCBzdGFuZGFsb25lIGJhY2tncm91bmQgdXBkYXRlcy4KIyBTZXQgdG8gMCB0byBkaXNhYmxlIGF1dG9tYXRpYyBkaXNjb3ZlcnkgYW5kIGluc3RhbGxhdGlvbiAoZXhwbGljaXQgYWZiaW4gdXBkYXRlIHN0aWxsIHdvcmtzKS4KIyBDTElfX0FVVE9fVVBEQVRFPTEKIyBBIHZlcnNpb24gcGluIGRpc2FibGVzIGF1dG9tYXRpYyB1cGRhdGVzIGFuZCByZXN0cmljdHMgZXhwbGljaXQgdXBkYXRlcyB0byB0aGF0IHJlbGVhc2UuCiMgQ0xJX19WRVJTSU9OX1BJTj0K';
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
