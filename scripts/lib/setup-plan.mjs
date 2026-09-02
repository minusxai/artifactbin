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
const ENV_EXAMPLE_BASE64 = 'IyBSdW4gYG5wbSBydW4gc2V0dXBgIHRvIGdlbmVyYXRlIGEgc2VjdXJlIGAuZW52YCBmb3IgdGhpcyBjaGVja291dC4KCiMgRW5hYmxlcyBvcGVyYXRpb25hbCB0b2tlbiBtaW50L3Jldm9rZSBlbmRwb2ludHMuIEdlbmVyYXRlIHdpdGg6IG9wZW5zc2wgcmFuZCAtYmFzZTY0IDMyCkFETUlOX19TRUNSRVQ9CgojIFNpZ25zIGxvZ2luIHNlc3Npb25zLiBHZW5lcmF0ZSB3aXRoOiBvcGVuc3NsIHJhbmQgLWJhc2U2NCAzMgpBVVRIX19TRUNSRVQ9CgojIFVuc2V0IHVzZXMgZW1iZWRkZWQgUEdMaXRlIGF0IC4vZGF0YS9wZ2xpdGUuIEFsc28gYWNjZXB0cyBwZ2xpdGU6Ly9tZW1vcnkgb3IgUG9zdGdyZXMuCiMgREFUQUJBU0VfVVJMPXBnbGl0ZTovLy4vZGF0YS9wZ2xpdGUKCiMgVXNlZCBvbmx5IGJ5IGBucG0gcnVuIG1pbnRgOyBkZWZhdWx0cyB0byBBUFBfX1BVQkxJQ19CQVNFX1VSTC4KIyBCQVNFX1VSTD1odHRwOi8vbG9jYWxob3N0OjMwMzAKCiMgUHVibGljIG9yaWdpbiBhbmQgbGlzdGVuaW5nIHBvcnQuIEFQUF9fSE1SX1BPUlQgZGVmYXVsdHMgdG8gQVBQX19QT1JUICsgMS4KQVBQX19QVUJMSUNfQkFTRV9VUkw9aHR0cDovL2xvY2FsaG9zdDozMDMwCkFQUF9fUE9SVD0zMDMwCiMgQVBQX19IT1NUPQpBUFBfX0hNUl9QT1JUPQoKIyBQZXItdG9rZW4gYXJ0aWZhY3QgY2FwOyAwIGRpc2FibGVzIHRoZSBjYXAuClFVT1RBX19BUlRJRkFDVFNfUEVSX1RPS0VOPTEwMDAKCiMgTG9jYWwgZGV2ZWxvcG1lbnQgd3JpdGVzIGxvZ2luIG1haWwgdG8gLmFydGlmYWN0YmluL2Rldi1tYWlsLmpzb25sOyByZWFkIGEgY29kZSB3aXRoOgojICAgbnBtIHJ1biBkZXY6b3RwIC0tIHlvdUBleGFtcGxlLmNvbQojIE9wdGlvbmFsIG92ZXJyaWRlIGZvciBzdGFuZGFsb25lIHByb2Nlc3NlcyBhbmQgdGVzdCBvcmNoZXN0cmF0aW9uLgpFTUFJTF9fREVWX09VVEJPWF9QQVRIPQojIFB1YmxpYyBkZXBsb3ltZW50cyByZXF1aXJlIGEgUmVzZW5kIGtleSBhbmQgdmVyaWZpZWQgc2VuZGVyLgpFTUFJTF9fUkVTRU5EX0FQSV9LRVk9CkVNQUlMX19GUk9NPWFydGlmYWN0YmluIDxsb2dpbkB2ZXJpZnkuYXJ0aWZhY3RiaW4uZGV2PgoKIyBVbnNldCBTM19VUkwgc3RvcmVzIG9iamVjdHMgbG9jYWxseS4gUGVyY2VudC1lbmNvZGUgY3JlZGVudGlhbHMgaW4gUzMgVVJMcy4KIyBTM19VUkw9czM6Ly9LRVk6U0VDUkVUQHMzLnJlZ2lvbi5hbWF6b25hd3MuY29tL2J1Y2tldC9wcmVmaXg/cmVnaW9uPXJlZ2lvbgpPQkpFQ1RfU1RPUkVfX0xPQ0FMX0RJUj0uYXJ0aWZhY3Qtb2JqZWN0cwoKSU1BR0VTX19NQVhfQllURVM9NTAwMDAwMAoKIyBXZWIgaW1wb3J0cyBibG9jayBwcml2YXRlIG5ldHdvcmtzIGJ5IGRlZmF1bHQuCldFQl9JTkdFU1RfX0FMTE9XX1BSSVZBVEU9MApXRUJfSU5HRVNUX19USU1FT1VUX01TPTEwMDAwCldFQl9JTkdFU1RfX01BWF9QRVJfSE9VUj0zMDAKV0VCX0lOR0VTVF9fTUFYX0lNQUdFU19QRVJfUFVCTElTSD04CgpTUUxfX01BWF9ST1dTPTEwMDAwClNRTF9fTUFYX1FVRVJZX1JPV1M9MTAwMDAKU1FMX19RVUVSWV9USU1FT1VUX01TPTUwMDAKCiMgUHVibGljIGRlcGxveW1lbnRzIG5vcm1hbGx5IG9wZW4gYW5vbnltb3VzIG1pbnRpbmc7IHNlbGYtaG9zdGVkIHByb2R1Y3Rpb24gZGVmYXVsdHMgdG8gMCB3aGVuIHVuc2V0LgpSQVRFX0xJTUlURVJfX0FOT05fTUlOVF9NQVg9MTAKUkFURV9MSU1JVEVSX19UUlVTVEVEX1BST1hZX0hPUFM9MQpSQVRFX0xJTUlURVJfX01VVEFURV9NQVg9NjAKCiMgT3B0aW9uYWwgZGVwbG95bWVudC13aWRlIHByZXZpZXcgc3dpdGNoOyBwcmV2aWV3cyBvdGhlcndpc2UgcmVxdWlyZSA/dj0yLgpQUkVWSUVXX19GRUFUVVJFUz0xCgojIE9wdGlvbmFsIGRlcGxveW1lbnQgY29udHJvbHMuCiMgQVJUSUZBQ1RTX19BTExPV19QVUJMSUM9MQojIEFOQUxZVElDU19fU0VDUkVUPQoKIyBTcGxpdC1zZXJ2aWNlIGRlcGxveW1lbnQuIElOVEVSTkFMX19TRVJWSUNFX1NFQ1JFVCBtdXN0IG1hdGNoIGFjcm9zcyBhcHAsIFNRTCwgYW5kIGJyb3dzZXIuCiMgQVBQX19VUFNUUkVBTV9VUkw9aHR0cDovL2FwcDozMDAwCiMgQ09OVFJBQ1RfX0FDVE9SX1NFQ1JFVD0KIyBCUk9XU0VSX19TRVJWSUNFX1VSTD1odHRwOi8vYnJvd3Nlcjo4MDgwCiMgSU5URVJOQUxfX1NFUlZJQ0VfU0VDUkVUPQojIFNRTF9fU0VSVklDRV9VUkw9aHR0cDovL3NxbDo4MDgwCkVYUE9SVF9fSU5URVJOQUxfT1JJR0lOPQoKIyBTdGFuZGFsb25lIHByb3h5IGRhdGFiYXNlIHNjaGVtYXMgYW5kIGZvcndhcmRpbmcgYmVoYXZpb3IuCiMgQVVUSF9fU0NIRU1BPWF1dGgKIyBBUFBfX1NDSEVNQT1hcHAKIyBQUk9YWV9fU0VDVVJFX0NPT0tJRVM9CiMgVVBTVFJFQU1fX0RFQURMSU5FX01TPTMwMDAwCgojIE9wdGlvbmFsIEdvb2dsZSBsb2dpbi4KIyBBVVRIX19HT09HTEVfQ0xJRU5UX0lEPQojIEFVVEhfX0dPT0dMRV9DTElFTlRfU0VDUkVUPQoKIyBPcHRpb25hbCBPSURDIGxvZ2luLiBVc2UgZXhwbGljaXQgZW5kcG9pbnRzIG9yIGRpc2NvdmVyeSwgbm90IGJvdGguCiMgQVVUSF9fT0lEQ19QUk9WSURFUl9JRD1vaWRjCiMgQVVUSF9fT0lEQ19DTElFTlRfSUQ9CiMgQVVUSF9fT0lEQ19DTElFTlRfU0VDUkVUPQojIEFVVEhfX09JRENfQVVUSE9SSVpBVElPTl9VUkw9CiMgQVVUSF9fT0lEQ19UT0tFTl9VUkw9CiMgQVVUSF9fT0lEQ19VU0VSSU5GT19VUkw9CiMgQVVUSF9fT0lEQ19ESVNDT1ZFUllfVVJMPQoKIyBSQVRFX0xJTUlURVJfXzxET09SPl97TUFYLFdJTkRPVyxCVVJTVCxLRVl9OyBLRVkgaXMgaXAsIGFjdG9yLCBvciBpcCthY3Rvci4KIyBEb29yczogR0xPQkFMLCBBTk9OX01JTlQsIExPR0lOX1NFTkQsIExPR0lOX1ZFUklGWSwgUFVCTElTSCwgRURJVCwgTVVUQVRFLCBRVUVSWSwgRVhQT1JULCBFVkVOVFNfU1RSRUFNUywgT0FVVEhfVE9LRU4uCg==';
const ENV_EXAMPLE = Buffer.from(ENV_EXAMPLE_BASE64, 'base64').toString('utf8');

function httpUrlError(value) {
  try {
    const url = new URL(String(value));
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname) return undefined;
  } catch {}
  return 'Public URL must be an absolute http(s) URL';
}

function portError(value) {
  return Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 65535
    ? undefined
    : 'Port must be an integer from 1 to 65535';
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

function publicUrlFromPort(port) {
  const url = new URL(DEFAULT_PUBLIC_URL);
  url.port = String(port);
  return url.origin;
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
  const explicit = Object.fromEntries([...supplied].filter((key) => key in answerOverrides).map((key) => [key, answerOverrides[key]]));
  const answers = defaultAnswers({ ...prior, ...explicit });
  const secrets = { ...generated };
  for (const name of ['AUTH__SECRET', 'ADMIN__SECRET', 'CONTRACT__ACTOR_SECRET', 'INTERNAL__SERVICE_SECRET']) {
    if (current.get(name)) secrets[name] = current.get(name);
  }
  // Explicit replacements were validated at the CLI/interview boundary.
  // Existing values are preserved verbatim, even when the editor would not
  // create them (for example a driver-specific connection-string spelling).
  let text = buildEnvFile(answers, { generated: secrets, validate: false });
  const replaced = new Set([...supplied].flatMap((key) => MANAGED_ENV[key] ?? []));
  for (const [name, value] of current) {
    if (!replaced.has(name)) text = replaceEnvLine(text, name, value);
  }
  return text.endsWith('\n') ? text : `${text}\n`;
}
