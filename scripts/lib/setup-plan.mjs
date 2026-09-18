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
const ENV_EXAMPLE_BASE64 = 'IyBSdW4gYG5wbSBydW4gc2V0dXBgIHRvIGdlbmVyYXRlIGEgc2VjdXJlIGAuZW52YCBmb3IgdGhpcyBjaGVja291dC4KCiMgRW5hYmxlcyBvcGVyYXRpb25hbCB0b2tlbiBtaW50L3Jldm9rZSBlbmRwb2ludHMuIEdlbmVyYXRlIHdpdGg6IG9wZW5zc2wgcmFuZCAtYmFzZTY0IDMyCkFETUlOX19TRUNSRVQ9CgojIFNpZ25zIGxvZ2luIHNlc3Npb25zLiBHZW5lcmF0ZSB3aXRoOiBvcGVuc3NsIHJhbmQgLWJhc2U2NCAzMgpBVVRIX19TRUNSRVQ9CgojIFVuc2V0IHVzZXMgZW1iZWRkZWQgUEdMaXRlIGF0IC4vZGF0YS9wZ2xpdGUuIEFsc28gYWNjZXB0cyBwZ2xpdGU6Ly9tZW1vcnkgb3IgUG9zdGdyZXMuCiMgREFUQUJBU0VfVVJMPXBnbGl0ZTovLy4vZGF0YS9wZ2xpdGUKCiMgUHVibGljIG9yaWdpbiBhbmQgbGlzdGVuaW5nIHBvcnQuIEFQUF9fSE1SX1BPUlQgZGVmYXVsdHMgdG8gQVBQX19QT1JUICsgMS4KQVBQX19QVUJMSUNfQkFTRV9VUkw9aHR0cDovL2xvY2FsaG9zdDozMDMwCiMgT3B0aW9uYWwgZGVkaWNhdGVkIG9yaWdpbiB0aGF0IHNlcnZlcyBvbmx5IGFub255bW91cyBjYWNoZWQgYnl0ZXMgYXQgL2Fzc2V0cy8qLgojIFByb2R1Y3Rpb24gcmVxdWlyZXMgYSBkaXN0aW5jdCBIVFRQUyBob3N0bmFtZTsgSFRUUCBpcyBhY2NlcHRlZCBvbmx5IG9uIGxvb3BiYWNrLgojIEFQUF9fQVNTRVRTX09SSUdJTj1odHRwczovL2Fzc2V0cy5leGFtcGxlLmNvbQojIE90aGVyIG9yaWdpbnMgdGhpcyBzYW1lIGRlcGxveW1lbnQgYW5zd2VycyBhdCAoYSBtYXJrZXRpbmcgaG9zdG5hbWUgdGhhdCBwcm94aWVzCiMgaGVyZSwgYSBwcmV2aW91cyBuYW1lKS4gQ29tbWEtc2VwYXJhdGVkOyBIVFRQUywgb3IgSFRUUCBvbiBsb29wYmFjazsgbm8gcGF0aCBvcgojIGNyZWRlbnRpYWxzLiBTZXJ2ZWQgYXQgR0VUIC9hcGkvc2VydmVyLCBzbyBhZmJpbiB0cmVhdHMgYSBsaW5rIG9yIGEgZm9sZGVyIGZyb20KIyBlaXRoZXIgbmFtZSBhcyB0aGlzIHNlcnZlcjsgcmVxdWVzdHMgYW5kIGNyZWRlbnRpYWxzIHN0aWxsIGdvIHRvCiMgQVBQX19QVUJMSUNfQkFTRV9VUkwgYWxvbmUuIEEgbWFsZm9ybWVkIGVudHJ5IHJlZnVzZXMgdGhlIGJvb3QuCiMgQVBQX19BTElBU19PUklHSU5TPWh0dHBzOi8vZXhhbXBsZS5jb20KQVBQX19QT1JUPTMwMzAKIyBBUFBfX0hPU1Q9CkFQUF9fSE1SX1BPUlQ9CgojIFBlci10b2tlbiBhcnRpZmFjdCBjYXA7IDAgZGlzYWJsZXMgdGhlIGNhcC4KUVVPVEFfX0FSVElGQUNUU19QRVJfVE9LRU49MTAwMAoKIyBTdG9yZWQgYnl0ZXMgb25lIGltcG9ydGVyIG1heSBjYXVzZSAodXBsb2FkcyArIHRoZSBVUkxzIGl0IGltcG9ydGVkIGZpcnN0KTsgMCBkaXNhYmxlcy4KIyBBU1NFVFNfX01BWF9CWVRFU19QRVJfVE9LRU49NTM2ODcwOTEyCgojIExvY2FsIGRldmVsb3BtZW50IHdyaXRlcyBsb2dpbiBtYWlsIHRvIC5hcnRpZmFjdGJpbi9kZXYtbWFpbC5qc29ubDsgcmVhZCBhIGNvZGUgd2l0aDoKIyAgIG5wbSBydW4gZGV2Om90cCAtLSB5b3VAZXhhbXBsZS5jb20KIyBPcHRpb25hbCBvdmVycmlkZSBmb3Igc3RhbmRhbG9uZSBwcm9jZXNzZXMgYW5kIHRlc3Qgb3JjaGVzdHJhdGlvbi4KIyBFTUFJTF9fREVWX09VVEJPWF9QQVRIPQojIFB1YmxpYyBkZXBsb3ltZW50cyByZXF1aXJlIGEgUmVzZW5kIGtleSBhbmQgdmVyaWZpZWQgc2VuZGVyLgpFTUFJTF9fUkVTRU5EX0FQSV9LRVk9CkVNQUlMX19GUk9NPWFydGlmYWN0YmluIDxsb2dpbkBleGFtcGxlLmNvbT4KCiMgVW5zZXQgUzNfVVJMIHN0b3JlcyBvYmplY3RzIGxvY2FsbHkuIFBlcmNlbnQtZW5jb2RlIGNyZWRlbnRpYWxzIGluIFMzIFVSTHMuCiMgUzNfVVJMPXMzOi8vS0VZOlNFQ1JFVEBzMy5yZWdpb24uYW1hem9uYXdzLmNvbS9idWNrZXQvcHJlZml4P3JlZ2lvbj1yZWdpb24KT0JKRUNUX1NUT1JFX19MT0NBTF9ESVI9LmFydGlmYWN0LW9iamVjdHMKCklNQUdFU19fTUFYX0JZVEVTPTUwMDAwMDAKUERGX19NQVhfQllURVM9MjUwMDAwMDAKRklMRVNfX01BWF9CWVRFUz01MDAwMDAwMAoKIyBXZWIgaW1wb3J0cyBibG9jayBwcml2YXRlIG5ldHdvcmtzIGJ5IGRlZmF1bHQuCldFQl9JTkdFU1RfX0FMTE9XX1BSSVZBVEU9MApXRUJfSU5HRVNUX19USU1FT1VUX01TPTEwMDAwCldFQl9JTkdFU1RfX01BWF9QRVJfSE9VUj0zMDAKV0VCX0lOR0VTVF9fTUFYX0lNQUdFU19QRVJfUFVCTElTSD04CldFQl9JTkdFU1RfX01BWF9BU1NFVFNfUEVSX1BVQkxJU0g9MTYKClNRTF9fTUFYX1JPV1M9MTAwMDAKU1FMX19NQVhfUVVFUllfUk9XUz0xMDAwMApTUUxfX1FVRVJZX1RJTUVPVVRfTVM9NTAwMAoKIyBOdW1iZXIgb2YgdHJ1c3RlZCBmb3J3YXJkaW5nIGhvcHMgdXNlZCB0byBpbnRlcnByZXQgY2xpZW50IGFkZHJlc3Nlcy4KSFRUUF9fVFJVU1RFRF9QUk9YWV9IT1BTPTEKCiMgT3B0aW9uYWwgZGVwbG95bWVudCBjb250cm9scy4KIyBBUlRJRkFDVFNfX0FMTE9XX1BVQkxJQz0xCiMgQU5BTFlUSUNTX19TRUNSRVQ9CgojIFNwbGl0LXNlcnZpY2UgZGVwbG95bWVudC4gSU5URVJOQUxfX1NFUlZJQ0VfU0VDUkVUIG11c3QgbWF0Y2ggYWNyb3NzIGFwcCwgU1FMLCBicm93c2VyIGFuZCBldmVudHMuCiMgQ09OVFJBQ1RfX0FDVE9SX1NFQ1JFVD0KIyBCUk9XU0VSX19TRVJWSUNFX1VSTD1odHRwOi8vYnJvd3Nlcjo4MDgwCiMgT3B0aW9uYWwgZGlyZWN0IGV4cG9ydCB1cGxvYWQ7IGV4YWN0IFMzIG9yaWdpbiBhbmQgZXhwb3J0IG9iamVjdCBwcmVmaXggb25seS4KIyBCUk9XU0VSX19VUExPQURfT1JJR0lOPWh0dHBzOi8vYnVja2V0LnMzLnVzLXdlc3QtMS5hbWF6b25hd3MuY29tCiMgQlJPV1NFUl9fVVBMT0FEX1BSRUZJWD0vYXJ0aWZhY3RzL2V4cG9ydHMvb2JqZWN0cy8KIyBJbnRlcm5hbC1vbmx5IGJyb3dzZXJzIHJlYWNoIFMzIHRocm91Z2ggdGhlIHNjb3BlZCB1cGxvYWQgZ2F0ZXdheS4KIyBCUk9XU0VSX19VUExPQURfUFJPWFlfVVJMPWh0dHA6Ly91cGxvYWQtZ2F0ZXdheTo4MDgwCiMgQnJvd3NlciBzZXNzaW9ucyByZXF1aXJlIExpbnV4IGJ1YmJsZXdyYXAgd2l0aCB1bnByaXZpbGVnZWQgdXNlciBuYW1lc3BhY2VzLgojIERFVkVMT1BNRU5UIE9OTFkuIEJST1dTRVJfX1NBTkRCT1g9bm9uZSBydW5zIHRoZSBzZXNzaW9uIHdvcmtlciBhcyBhIHBsYWluIGNoaWxkCiMgcHJvY2Vzczogbm8gYnViYmxld3JhcCwgbm8gY2dyb3VwLCBOTyBPUyBjb250YWlubWVudCDigJQgYSBzZXNzaW9uIHNjcmlwdCB0aGVuIGhhcyB0aGUKIyB3aG9sZSBtYWNoaW5lLCB0aGlzIGNoZWNrb3V0IGFuZCB0aGUgbmV0d29yay4gSXQgZXhpc3RzIHNvIGxpdmUgc2Vzc2lvbnMgcnVuIG9uIGEKIyBtYWNPUyBkZXYgaG9zdCBhdCBhbGw7IGBucG0gcnVuIGRldmAgYWxyZWFkeSBkZWZhdWx0cyBpdCB0aGVyZS4gSXQgaXMgcmVmdXNlZCB3aGVuCiMgTk9ERV9FTlY9cHJvZHVjdGlvbiwgYW5kIGFueSBvdGhlciB2YWx1ZSBpcyByZWZ1c2VkIG91dHJpZ2h0LiBOZXZlciBzZXQgaXQgb24gYSBzZXJ2ZXIuCiMgQlJPV1NFUl9fU0FOREJPWD1ub25lCiMgU3BsaXQgYnJvd3NlciBzZXJ2aWNlOiB0cnVzdGVkIGFwcCBVUkw7IGFsc28gc2V0IEFQUF9fUFVCTElDX0JBU0VfVVJMIGFuZCBDT05UUkFDVF9fQUNUT1JfU0VDUkVUIHRoZXJlLgojIEJST1dTRVJfX1NFU1NJT05fQVBQX1VSTD1odHRwOi8vYXBwOjgwODAKIyBXcml0YWJsZSBkZWxlZ2F0ZWQgY2dyb3VwIHYyIHN1YnRyZWUgd2l0aCBjcHUsIG1lbW9yeSBhbmQgcGlkcyBjb250cm9sbGVycyBlbmFibGVkLgojIEJST1dTRVJfX1NFU1NJT05fQ0dST1VQX1JPT1Q9L3N5cy9mcy9jZ3JvdXAvYWZiaW4tc2Vzc2lvbnMKIyBJTlRFUk5BTF9fU0VSVklDRV9TRUNSRVQ9CiMgU1FMX19TRVJWSUNFX1VSTD1odHRwOi8vc3FsOjgwODAKIyBFdmVudHMgdXNlIHRoZSBsb2NhbCBkYXRhYmFzZSB1bmxlc3MgYW4gSFRUUCBzZXJ2aWNlIFVSTCBpcyBjb25maWd1cmVkLgojIEVWRU5UU19fU0VSVklDRV9VUkw9aHR0cDovL2V2ZW50czo4MDgwCiMgRVZFTlRTX19TQ0hFTUE9ZXZlbnRzCkVYUE9SVF9fSU5URVJOQUxfT1JJR0lOPQoKIyBPcHRpb25hbCBkYXRhYmFzZSBzY2hlbWEgbmFtZXMuCiMgQVVUSF9fU0NIRU1BPWF1dGgKIyBBUFBfX1NDSEVNQT1hcHAKCiMgT3B0aW9uYWwgR29vZ2xlIGxvZ2luLgojIEFVVEhfX0dPT0dMRV9DTElFTlRfSUQ9CiMgQVVUSF9fR09PR0xFX0NMSUVOVF9TRUNSRVQ9CgojIE9wdGlvbmFsIE9JREMgbG9naW4uIFVzZSBleHBsaWNpdCBlbmRwb2ludHMgb3IgZGlzY292ZXJ5LCBub3QgYm90aC4KIyBBVVRIX19PSURDX1BST1ZJREVSX0lEPW9pZGMKIyBBVVRIX19PSURDX0NMSUVOVF9JRD0KIyBBVVRIX19PSURDX0NMSUVOVF9TRUNSRVQ9CiMgQVVUSF9fT0lEQ19BVVRIT1JJWkFUSU9OX1VSTD0KIyBBVVRIX19PSURDX1RPS0VOX1VSTD0KIyBBVVRIX19PSURDX1VTRVJJTkZPX1VSTD0KIyBBVVRIX19PSURDX0RJU0NPVkVSWV9VUkw9CgoKIyBQZXJtaXQgUG9zdGdyZXMgY29ubmVjdGlvbnMgdG8gbG9vcGJhY2svcHJpdmF0ZSBuZXR3b3JrcyAoc2VsZi1ob3N0ZWQgZGVwbG95bWVudHMgb25seSkuCiMgTGluay1sb2NhbCwgbWV0YWRhdGEsIG11bHRpY2FzdCBhbmQgdW5zcGVjaWZpZWQgZGVzdGluYXRpb25zIHJlbWFpbiBibG9ja2VkLgpEQVRBU0VUX19BTExPV19QUklWQVRFX05FVFdPUktTPWZhbHNlCiMgT3B0aW9uYWwgY29tbWEtc2VwYXJhdGVkIGxpdGVyYWwgRE5TIHNlcnZlciBJUHMgZm9yIGRhdGFzZXQgUG9zdGdyZVNRTCBob3N0IHJlc29sdXRpb24gb25seS4KIyBFbXB0eSB1c2VzIHRoZSBvcGVyYXRpbmcgc3lzdGVtIHJlc29sdmVyLgpEQVRBU0VUX19ETlNfU0VSVkVSUz0KCiMgQ0xJLW9ubHkgc2VydmljZSBtaXJyb3I6IGV4cG9ydCB0aGlzIGluIHRoZSBzaGVsbCBydW5uaW5nIGFmYmluOyBjaGVja3N1bXMgcmVtYWluIHBpbm5lZC4KIyBBbiBIVFRQUyBiYXNlIFVSTCAob3B0aW9uYWwgcGF0aCBwcmVmaXgpLCBvciBIVFRQIGxvb3BiYWNrOyBzZXJ2ZXMgYWZiaW4tdlZFUlNJT04vYWZiaW4tc3FsLU9TLUFSQ0guZ3ouCiMgQ0xJX19TRVJWSUNFX0JBU0VfVVJMPQoKIyBDTEktb25seTogZXhwb3J0ZWQgc2V0dGluZ3MgZm9yIG1hbmFnZWQgc3RhbmRhbG9uZSBiYWNrZ3JvdW5kIHVwZGF0ZXMuCiMgU2V0IHRvIDAgdG8gZGlzYWJsZSBhdXRvbWF0aWMgZGlzY292ZXJ5IGFuZCBpbnN0YWxsYXRpb24gKGV4cGxpY2l0IGFmYmluIHVwZGF0ZSBzdGlsbCB3b3JrcykuCiMgQ0xJX19BVVRPX1VQREFURT0xCiMgQSB2ZXJzaW9uIHBpbiBkaXNhYmxlcyBhdXRvbWF0aWMgdXBkYXRlcyBhbmQgcmVzdHJpY3RzIGV4cGxpY2l0IHVwZGF0ZXMgdG8gdGhhdCByZWxlYXNlLgojIENMSV9fVkVSU0lPTl9QSU49Cg==';
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
