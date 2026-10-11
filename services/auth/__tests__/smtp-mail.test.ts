import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SMTPServer } from 'smtp-server';
import type { AddressInfo } from 'node:net';
import { mailSettingsOf, completeLoginMethods } from '../src/config';
import { smtpMailer, mailerForRuntime } from '../src/mail';
import { authEnvNamesRead } from '../src/env';
import { PGlite } from '@electric-sql/pglite';
import { createHumanAuth } from '../src/auth/human';

const env = { EMAIL__SMTP_HOST: 'localhost', EMAIL__FROM: 'Company <login@example.test>' };
const otp = { to: 'member@example.test', kind: 'otp', subject: 'unused', text: 'unused', otp: '428163' } as const;
let directory: string, cert: Buffer, key: Buffer;
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'afbin-smtp-tls-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
  cert = readFileSync(join(directory, 'cert.pem')); key = readFileSync(join(directory, 'key.pem'));
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

async function fixture(options: { secure?: boolean; reject?: boolean; rejectAuth?: boolean; starttls?: boolean } = {}) {
  const messages: string[] = [], sessions: boolean[] = [];
  const server = new SMTPServer({ key, cert, secure: options.secure, authOptional: true,
    ...(options.starttls === false ? { disabledCommands: ['STARTTLS'] } : {}),
    logger: false,
    onAuth(auth, _session, callback) {
      if (options.rejectAuth || auth.username !== 'fixture' || auth.password !== 'fixture-password') return callback(new Error('fixture-password 428163 authentication refused'));
      callback(null, { user: 'fixture' });
    },
    onData(stream, session, callback) {
      let body = ''; stream.on('data', chunk => { body += chunk.toString(); });
      stream.on('end', () => { sessions.push(session.secure); messages.push(body); callback(options.reject ? new Error('428163 fixture-password rejected') : undefined); });
    },
  });
  server.on('error', () => {});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.server.address() as AddressInfo).port;
  return { port, messages, sessions, close: () => new Promise<void>(resolve => server.close(resolve)) };
}

describe('SMTP configuration', () => {
  it('audits and completes SMTP with enforced STARTTLS defaults, preserving Resend shape', () => {
    expect(mailSettingsOf(env)).toEqual({ from: env.EMAIL__FROM, smtp: { host: 'localhost', port: 587, secure: false } });
    expect(completeLoginMethods(env).mail).toEqual(mailSettingsOf(env));
    expect(mailSettingsOf({ ...env, EMAIL__SMTP_SECURE: 'true' }).smtp).toMatchObject({ port: 465, secure: true });
    for (const name of ['HOST','PORT','SECURE','USER','PASSWORD']) expect(authEnvNamesRead().has(`EMAIL__SMTP_${name}`)).toBe(true);
    expect(completeLoginMethods({ EMAIL__RESEND_API_KEY: 're_test', EMAIL__FROM: 'x' }).mail).toEqual({ apiKey: 're_test', from: 'x' });
    expect(completeLoginMethods({ EMAIL__SMTP_HOST: 'localhost' }).mail).toBeUndefined();
  });
  it('rejects incomplete, unsafe, or ambiguous settings without printing their values', () => {
    for (const invalid of [
      { EMAIL__SMTP_HOST: 'smtp://fixture-password@host' },
      { EMAIL__SMTP_PORT: '587' }, { EMAIL__SMTP_SECURE: 'yes' },
      { EMAIL__SMTP_PORT: '0' }, { EMAIL__SMTP_PORT: '12.5' },
      { EMAIL__SMTP_USER: 'fixture-password' }, { EMAIL__SMTP_PASSWORD: 'fixture-password' },
      { EMAIL__RESEND_API_KEY: 'fixture-password' },
    ]) {
      const source: Record<string, string | undefined> = { ...env, ...invalid };
      if (!invalid.EMAIL__SMTP_HOST && 'EMAIL__SMTP_PORT' in invalid && invalid.EMAIL__SMTP_PORT === '587') delete source.EMAIL__SMTP_HOST;
      expect(() => mailSettingsOf(source)).toThrow();
      try { mailSettingsOf(source); } catch (error) { expect(String(error)).not.toContain('fixture-password'); }
    }
  });
});

describe('SMTP real local transport', () => {
  for (const secure of [false, true]) it(`delivers OTP over ${secure ? 'implicit TLS' : 'STARTTLS'} with verified certificate and auth`, async () => {
    const server = await fixture({ secure });
    try {
      const settings = { host: 'localhost', port: server.port, secure, user: 'fixture', password: 'fixture-password' };
      await smtpMailer({ from: env.EMAIL__FROM, smtp: settings }, { ca: cert }).send(otp);
      expect(server.sessions).toEqual([true]);
      expect(server.messages).toHaveLength(1);
      expect(server.messages[0]).toContain('Subject: 428163 is your artifactbin login code');
      expect(server.messages[0]).toContain('Your artifactbin login code is 428163');
      expect(server.messages[0]).toContain('member@example.test');
      expect(server.messages[0]).toContain('login@example.test');
    } finally { await server.close(); }
  });
  it('accepts a TLS relay without login credentials', async () => {
    const server = await fixture();
    try { await smtpMailer({ from: env.EMAIL__FROM, smtp: { host: 'localhost', port: server.port, secure: false } }, { ca: cert }).send(otp); expect(server.sessions).toEqual([true]); }
    finally { await server.close(); }
  });
  for (const secure of [false, true]) it(`refuses an untrusted certificate for secure=${secure}`, async () => {
    const server = await fixture({ secure });
    try {
      await expect(mailerForRuntime({ publicBaseUrl: 'https://company.example.test', from: env.EMAIL__FROM, smtp: { host: 'localhost', port: server.port, secure } }).send(otp)).rejects.toThrow('mail send failed');
      expect(server.messages).toEqual([]);
    } finally { await server.close(); }
  });
  it('verifies the SMTP hostname even when its CA is trusted', async () => {
    const server = await fixture();
    try { await expect(smtpMailer({ from: env.EMAIL__FROM, smtp: { host: '127.0.0.1', port: server.port, secure: false } }, { ca: cert }).send(otp)).rejects.toThrow('mail send failed'); expect(server.messages).toEqual([]); }
    finally { await server.close(); }
  });
  it('completes normal verified email-code login using the delivered SMTP message', async () => {
    const server = await fixture(), pg = new PGlite();
    try {
      const auth = await createHumanAuth({ pglite: pg, secret: 'smtp-fixture-auth-secret'.padEnd(32, '0'), baseURL: 'http://localhost:4795', mail: smtpMailer({ from: env.EMAIL__FROM, smtp: { host: 'localhost', port: server.port, secure: false } }, { ca: cert }) });
      const request = (path: string, body: unknown) => auth.handler(new Request(`http://localhost:4795/api/auth${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:4795' }, body: JSON.stringify(body) }));
      expect((await request('/email-otp/send-verification-otp', { email: otp.to, type: 'sign-in' })).status).toBe(200);
      const code = /Subject: (\d{6}) is your artifactbin login code/.exec(server.messages[0])?.[1];
      expect(code).toMatch(/^\d{6}$/);
      const response = await request('/sign-in/email-otp', { email: otp.to, otp: code });
      expect(response.status).toBe(200);
      const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
      expect(await auth.sessions.resolve(new Request('http://localhost:4795/', { headers: { cookie } }))).toMatchObject({ email: otp.to, emailVerified: true });
    } finally { await server.close(); await pg.close(); }
  });
  it('refuses plaintext servers without STARTTLS', async () => {
    const server = await fixture({ starttls: false });
    try { await expect(smtpMailer({ from: env.EMAIL__FROM, smtp: { host: 'localhost', port: server.port, secure: false } }, { ca: cert }).send(otp)).rejects.toThrow('mail send failed'); expect(server.messages).toEqual([]); }
    finally { await server.close(); }
  });
  for (const rejectAuth of [true, false]) it(`sanitizes ${rejectAuth ? 'authentication' : 'delivery'} errors`, async () => {
    const server = await fixture({ rejectAuth, reject: !rejectAuth });
    try {
      const error = await smtpMailer({ from: env.EMAIL__FROM, smtp: { host: 'localhost', port: server.port, secure: false, user: 'fixture', password: 'fixture-password' } }, { ca: cert }).send(otp).catch(error => error);
      expect(error).toBeInstanceOf(Error); expect(error.message).toBe('mail send failed: SMTP delivery failed');
      expect(error.message).not.toMatch(/428163|fixture-password/);
    } finally { await server.close(); }
  });
});
