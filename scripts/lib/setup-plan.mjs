/**
 * Pure setup planning: the questions, CLI contract, validation, and rendered
 * environment file. The runner owns every side effect.
 *
 * The example is snapshotted because the runtime image deliberately contains
 * only the two setup modules; decoding this constant is deterministic and
 * keeps this module free of filesystem I/O.
 */

const DEFAULT_PUBLIC_URL = 'http://localhost:3030';

// Keep this snapshot byte-for-byte aligned with .env.example.
const ENV_EXAMPLE_BASE64 = 'IyBSdW4gYG5wbSBydW4gc2V0dXBgIHRvIGdlbmVyYXRlIGEgc2VjdXJlIGAuZW52YCBmb3IgdGhpcyBjaGVja291dC4KCiMgRW5hYmxlcyBvcGVyYXRpb25hbCB0b2tlbiBtaW50L3Jldm9rZSBlbmRwb2ludHMuIEdlbmVyYXRlIHdpdGg6IG9wZW5zc2wgcmFuZCAtYmFzZTY0IDMyCkFETUlOX19TRUNSRVQ9CgojIFNpZ25zIGxvZ2luIHNlc3Npb25zLiBHZW5lcmF0ZSB3aXRoOiBvcGVuc3NsIHJhbmQgLWJhc2U2NCAzMgpBVVRIX19TRUNSRVQ9CgojIFVuc2V0IHVzZXMgZW1iZWRkZWQgUEdMaXRlIGF0IC4vZGF0YS9wZ2xpdGUuIEFsc28gYWNjZXB0cyBwZ2xpdGU6Ly9tZW1vcnkgb3IgUG9zdGdyZXMuCiMgREFUQUJBU0VfVVJMPXBnbGl0ZTovLy4vZGF0YS9wZ2xpdGUKCiMgVXNlZCBvbmx5IGJ5IGBucG0gcnVuIG1pbnRgOyBkZWZhdWx0cyB0byBBUFBfX1BVQkxJQ19CQVNFX1VSTC4KIyBCQVNFX1VSTD1odHRwOi8vbG9jYWxob3N0OjMwMzAKCiMgUHVibGljIG9yaWdpbiBhbmQgbGlzdGVuaW5nIHBvcnQuIEFQUF9fSE1SX1BPUlQgZGVmYXVsdHMgdG8gQVBQX19QT1JUICsgMS4KQVBQX19QVUJMSUNfQkFTRV9VUkw9aHR0cDovL2xvY2FsaG9zdDozMDMwCkFQUF9fUE9SVD0zMDMwCiMgQVBQX19IT1NUPQpBUFBfX0hNUl9QT1JUPQoKIyBQZXItdG9rZW4gYXJ0aWZhY3QgY2FwOyAwIGRpc2FibGVzIHRoZSBjYXAuClFVT1RBX19BUlRJRkFDVFNfUEVSX1RPS0VOPTEwMDAKCiMgU3RvcmVkIGJ5dGVzIG9uZSBpbXBvcnRlciBtYXkgY2F1c2UgKHVwbG9hZHMgKyB0aGUgVVJMcyBpdCBpbXBvcnRlZCBmaXJzdCk7IDAgZGlzYWJsZXMuCiMgQVNTRVRTX19NQVhfQllURVNfUEVSX1RPS0VOPTUzNjg3MDkxMgoKIyBMb2NhbCBkZXZlbG9wbWVudCB3cml0ZXMgbG9naW4gbWFpbCB0byAuYXJ0aWZhY3RiaW4vZGV2LW1haWwuanNvbmw7IHJlYWQgYSBjb2RlIHdpdGg6CiMgICBucG0gcnVuIGRldjpvdHAgLS0geW91QGV4YW1wbGUuY29tCiMgT3B0aW9uYWwgb3ZlcnJpZGUgZm9yIHN0YW5kYWxvbmUgcHJvY2Vzc2VzIGFuZCB0ZXN0IG9yY2hlc3RyYXRpb24uCiMgRU1BSUxfX0RFVl9PVVRCT1hfUEFUSD0KIyBQdWJsaWMgZGVwbG95bWVudHMgcmVxdWlyZSBhIFJlc2VuZCBrZXkgYW5kIHZlcmlmaWVkIHNlbmRlci4KRU1BSUxfX1JFU0VORF9BUElfS0VZPQpFTUFJTF9fRlJPTT1hcnRpZmFjdGJpbiA8bG9naW5AdmVyaWZ5LmFydGlmYWN0YmluLmRldj4KCiMgVW5zZXQgUzNfVVJMIHN0b3JlcyBvYmplY3RzIGxvY2FsbHkuIFBlcmNlbnQtZW5jb2RlIGNyZWRlbnRpYWxzIGluIFMzIFVSTHMuCiMgUzNfVVJMPXMzOi8vS0VZOlNFQ1JFVEBzMy5yZWdpb24uYW1hem9uYXdzLmNvbS9idWNrZXQvcHJlZml4P3JlZ2lvbj1yZWdpb24KT0JKRUNUX1NUT1JFX19MT0NBTF9ESVI9LmFydGlmYWN0LW9iamVjdHMKCklNQUdFU19fTUFYX0JZVEVTPTUwMDAwMDAKUERGX19NQVhfQllURVM9MjUwMDAwMDAKCiMgV2ViIGltcG9ydHMgYmxvY2sgcHJpdmF0ZSBuZXR3b3JrcyBieSBkZWZhdWx0LgpXRUJfSU5HRVNUX19BTExPV19QUklWQVRFPTAKV0VCX0lOR0VTVF9fVElNRU9VVF9NUz0xMDAwMApXRUJfSU5HRVNUX19NQVhfUEVSX0hPVVI9MzAwCldFQl9JTkdFU1RfX01BWF9JTUFHRVNfUEVSX1BVQkxJU0g9OApXRUJfSU5HRVNUX19NQVhfQVNTRVRTX1BFUl9QVUJMSVNIPTE2CgpTUUxfX01BWF9ST1dTPTEwMDAwClNRTF9fTUFYX1FVRVJZX1JPV1M9MTAwMDAKU1FMX19RVUVSWV9USU1FT1VUX01TPTUwMDAKCiMgRVZFUlkgUkFURS1MSU1JVCBOVU1CRVIgTElWRVMgSU4gQSBQT0xJQ1kgRklMRSwgbm90IGluIGFuIGVudiBuYW1lLiBUaHJlZSBzaGlwOgojICAgc2VydmljZXMvcHJveHkvZGVmYXVsdF9yYXRlX2xpbWl0cy55bWwgICBhbm9ueW1vdXMgbWludGluZyBDTE9TRUQgKDApIOKAlCB0aGUgcHJvZHVjdGlvbiBkZWZhdWx0CiMgICBzZXJ2aWNlcy9wcm94eS9zZWxmaG9zdF9yYXRlX2xpbWl0cy55bWwgIGFub255bW91cyBtaW50aW5nIGF0IDEwL2hvdXIvaXAg4oCUIHRoaXMgb25lCiMgICBzZXJ2aWNlcy9wcm94eS9kZXZfcmF0ZV9saW1pdHMueW1sICAgICAgIHdpZGUgb3BlbiAoMjAwMCksIHNvIGEgZ2F0ZSBydW4gY2Fubm90IGV4aGF1c3QgaXQKIyBDb3B5IG9uZSBhbmQgZWRpdCBpdCB0byBjaGFuZ2UgYSBidWRnZXQgb3IgYWRkIGEgcm91dGU7IHVuc2V0IG1lYW5zIHRoZSBjbG9zZWQgZGVmYXVsdC4KUFJPWFlfX1JBVEVfTElNSVRfQ09ORklHX0ZJTEU9c2VydmljZXMvcHJveHkvc2VsZmhvc3RfcmF0ZV9saW1pdHMueW1sClJBVEVfTElNSVRFUl9fVFJVU1RFRF9QUk9YWV9IT1BTPTEKCiMgT3B0aW9uYWwgZGVwbG95bWVudCBjb250cm9scy4KIyBBUlRJRkFDVFNfX0FMTE9XX1BVQkxJQz0xCiMgQU5BTFlUSUNTX19TRUNSRVQ9CgojIFNwbGl0LXNlcnZpY2UgZGVwbG95bWVudC4gSU5URVJOQUxfX1NFUlZJQ0VfU0VDUkVUIG11c3QgbWF0Y2ggYWNyb3NzIGFwcCwgU1FMLCBicm93c2VyIGFuZCBldmVudHMuCiMgQVBQX19VUFNUUkVBTV9VUkw9aHR0cDovL2FwcDozMDAwCiMgQ09OVFJBQ1RfX0FDVE9SX1NFQ1JFVD0KIyBCUk9XU0VSX19TRVJWSUNFX1VSTD1odHRwOi8vYnJvd3Nlcjo4MDgwCiMgSU5URVJOQUxfX1NFUlZJQ0VfU0VDUkVUPQojIFNRTF9fU0VSVklDRV9VUkw9aHR0cDovL3NxbDo4MDgwCiMgVGhlIGV2ZW50cyBzZXJ2aWNlIChzZXJ2aWNlcy9ldmVudHMpOiB1bnNldCwgbm90aGluZyBsZWF2ZXMgdGhlIGJveCBhbmQgdGhlIGZlZWQgcmVhZHMgZW1wdHkuCiMgRVZFTlRTX19TRVJWSUNFX1VSTD1odHRwOi8vZXZlbnRzOjgwODAKIyBFVkVOVFNfX1NDSEVNQT1ldmVudHMKRVhQT1JUX19JTlRFUk5BTF9PUklHSU49CgojIFN0YW5kYWxvbmUgcHJveHkgZGF0YWJhc2Ugc2NoZW1hcyBhbmQgZm9yd2FyZGluZyBiZWhhdmlvci4KIyBBVVRIX19TQ0hFTUE9YXV0aAojIEFQUF9fU0NIRU1BPWFwcAojIFBST1hZX19TRUNVUkVfQ09PS0lFUz0KIyBVUFNUUkVBTV9fREVBRExJTkVfTVM9MzAwMDAKCiMgT3B0aW9uYWwgR29vZ2xlIGxvZ2luLgojIEFVVEhfX0dPT0dMRV9DTElFTlRfSUQ9CiMgQVVUSF9fR09PR0xFX0NMSUVOVF9TRUNSRVQ9CgojIE9wdGlvbmFsIE9JREMgbG9naW4uIFVzZSBleHBsaWNpdCBlbmRwb2ludHMgb3IgZGlzY292ZXJ5LCBub3QgYm90aC4KIyBBVVRIX19PSURDX1BST1ZJREVSX0lEPW9pZGMKIyBBVVRIX19PSURDX0NMSUVOVF9JRD0KIyBBVVRIX19PSURDX0NMSUVOVF9TRUNSRVQ9CiMgQVVUSF9fT0lEQ19BVVRIT1JJWkFUSU9OX1VSTD0KIyBBVVRIX19PSURDX1RPS0VOX1VSTD0KIyBBVVRIX19PSURDX1VTRVJJTkZPX1VSTD0KIyBBVVRIX19PSURDX0RJU0NPVkVSWV9VUkw9CgoKIyBQZXJtaXQgUG9zdGdyZXMgY29ubmVjdGlvbnMgdG8gbG9vcGJhY2svcHJpdmF0ZSBuZXR3b3JrcyAoc2VsZi1ob3N0ZWQgZGVwbG95bWVudHMgb25seSkuCiMgTGluay1sb2NhbCwgbWV0YWRhdGEsIG11bHRpY2FzdCBhbmQgdW5zcGVjaWZpZWQgZGVzdGluYXRpb25zIHJlbWFpbiBibG9ja2VkLgpEQVRBU0VUX19BTExPV19QUklWQVRFX05FVFdPUktTPWZhbHNlCiMgT3B0aW9uYWwgY29tbWEtc2VwYXJhdGVkIGxpdGVyYWwgRE5TIHNlcnZlciBJUHMgZm9yIGRhdGFzZXQgUG9zdGdyZVNRTCBob3N0IHJlc29sdXRpb24gb25seS4KIyBFbXB0eSB1c2VzIHRoZSBvcGVyYXRpbmcgc3lzdGVtIHJlc29sdmVyLgpEQVRBU0VUX19ETlNfU0VSVkVSUz0K';
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
