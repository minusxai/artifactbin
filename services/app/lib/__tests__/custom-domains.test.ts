/**
 * CUSTOM DOMAINS — the rules, behind lib/custom-domains and nowhere else.
 *
 * One hostname per account, owned by the account id; attaching and verifying
 * are gated by FLAG__CUSTOM_DOMAINS, while removal, serving (ownerForHost),
 * the certificate ask check (isServable) and the daily re-check ignore it.
 * DNS is a deterministic fixture: no test here touches a live resolver.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const settings = vi.hoisted(() => ({ target: 'domains.example.test' as string | null }));
vi.mock('@/lib/config', async (original) => ({
  ...(await original<typeof import('@/lib/config')>()),
  get CUSTOM_DOMAINS_TARGET() { return settings.target; },
  get PUBLIC_BASE_URL() { return 'https://app.example.test'; },
  get ALIAS_ORIGINS() { return ['https://www.example-alias.test']; },
  get ASSETS_ORIGIN() { return 'https://assets.example.test'; },
}));

import { useAppHarness } from '@/__tests__/harness';
import { parseCustomDomainsTarget } from '@/lib/config';
import {
  attachDomain, domainOf, isServable, normalizeHostname, ownerForHost, recheckDomains, removeDomain, verifiedHostOf, verifyDomain,
  type CaaRecord, type DomainResolver,
} from '@/lib/custom-domains';
import { createTestUser, eraseTestUser } from '@/lib/testusers';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';

const harness = useAppHarness();
beforeEach(() => { settings.target = 'domains.example.test'; });

const TARGET_IP = '203.0.113.10';

/** A fixed DNS: names → records. Anything unlisted answers nothing, as NXDOMAIN does. */
function fixture(records: { txt?: Record<string, string[]>; addresses?: Record<string, string[]>; caa?: Record<string, CaaRecord[]> } = {}): DomainResolver & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    txt: async (name) => { asked.push(`txt:${name}`); return records.txt?.[name] ?? []; },
    addresses: async (name) => { asked.push(`addresses:${name}`); return records.addresses?.[name] ?? []; },
    caa: async (name) => { asked.push(`caa:${name}`); return records.caa?.[name] ?? []; },
  };
}

/** The DNS a person who followed the settings page has: TXT, routing, no CAA. */
const followed = (hostname: string, token: string, extra: Parameters<typeof fixture>[0] = {}) => fixture({
  txt: { [`_artifactbin.${hostname}`]: [token], ...extra.txt },
  addresses: { 'domains.example.test': [TARGET_IP], [hostname]: [TARGET_IP], ...extra.addresses },
  caa: extra.caa,
});

async function account(name: string) {
  const user = await createUser({ email: `${name}@example.com` });
  return user.id;
}

const attached = async (userId: string, hostname: string) => {
  const result = await attachDomain(userId, hostname);
  if ('error' in result) throw new Error(`attach refused: ${result.error}`);
  return result;
};

describe('attaching', () => {
  it('returns the two records to add, keyed to the account, and stores the hostname lowercase', async () => {
    const vivek = await account('vivek');
    const domain = await attached(vivek, 'Blog.VivekWebsite.com.');
    expect(domain).toMatchObject({
      hostname: 'blog.vivekwebsite.com',
      status: 'pending',
      txtName: '_artifactbin.blog.vivekwebsite.com',
      target: 'domains.example.test',
    });
    expect(domain.txtValue).toMatch(/\S{16,}/);
    expect(await domainOf(vivek)).toMatchObject({ hostname: 'blog.vivekwebsite.com', status: 'pending', txtValue: domain.txtValue });
    // Pending is not served, and is not a certificate the ask check admits.
    expect(await ownerForHost('blog.vivekwebsite.com')).toBeNull();
    expect(await isServable('blog.vivekwebsite.com')).toBe(false);
  });

  it('accepts a bare domain as well as a subdomain', async () => {
    expect(await attached(await account('bare'), 'vivekwebsite.com')).toMatchObject({ hostname: 'vivekwebsite.com', txtName: '_artifactbin.vivekwebsite.com' });
  });

  it('gives each account its own token, so a record proving one account never proves another', async () => {
    const a = await attached(await account('first'), 'a.example.org');
    const b = await attached(await account('second'), 'b.example.org');
    expect(a.txtValue).not.toBe(b.txtValue);
  });

  it('is refused with `disabled` while the flag is unset, and attaches nothing', async () => {
    const user = await account('flagoff');
    settings.target = null;
    expect(await attachDomain(user, 'blog.example.org')).toEqual({ error: 'disabled' });
    expect(await domainOf(user)).toBeNull();
    expect(parseCustomDomainsTarget(undefined)).toBeNull();
    expect(parseCustomDomainsTarget('  ')).toBeNull();
    expect(parseCustomDomainsTarget(' Domains.Example.Test. ')).toBe('domains.example.test');
  });

  it('refuses a name that is not a hostname: ports, IPs, single labels, bad labels, paths and schemes', async () => {
    const user = await account('invalid');
    for (const bad of ['', 'localhost', 'blog.example.org:8443', '203.0.113.7', '[2001:db8::1]', '2001:db8::1', 'http://blog.example.org', 'blog.example.org/path',
      '-bad.example.org', 'bad-.example.org', 'under_score.example.org', 'a..example.org', `${'a'.repeat(64)}.example.org`, 'example.123', '*.example.org']) {
      expect(await attachDomain(user, bad), bad).toEqual({ error: 'invalid_hostname' });
    }
    expect(normalizeHostname('Blog.Example.ORG')).toBe('blog.example.org');
    expect(normalizeHostname('blog.example.org:80')).toBeNull();
  });

  it('refuses our own app, alias, assets and DNS-target hosts and every name under them', async () => {
    const user = await account('ours');
    for (const ours of ['app.example.test', 'x.app.example.test', 'www.example-alias.test', 'deep.www.example-alias.test',
      'assets.example.test', 'x.assets.example.test', 'domains.example.test', 'x.domains.example.test']) {
      expect(await attachDomain(user, ours), ours).toEqual({ error: 'invalid_hostname' });
    }
    // A sibling of our host is somebody else's name, not ours.
    expect(await attached(user, 'blog.example.test')).toMatchObject({ hostname: 'blog.example.test' });
  });

  it('lets a pending claim block nobody: the real owner still attaches and verifies, and the squatter is cleared', async () => {
    const squatter = await account('squatter');
    const owner = await account('holder');
    const squat = await attached(squatter, 'blog.example.org');
    // Pending is not held: the real owner attaches the same name.
    const domain = await attached(owner, 'BLOG.example.org');
    expect(domain.txtValue).not.toBe(squat.txtValue);
    // The squatter cannot verify with the owner's record: the token is per account.
    const ownersDns = followed('blog.example.org', domain.txtValue);
    expect(await verifyDomain(squatter, 'blog.example.org', ownersDns)).toEqual({ error: 'txt_missing' });
    expect(await verifyDomain(owner, 'blog.example.org', ownersDns)).toMatchObject({ status: 'verified' });
    expect(await ownerForHost('blog.example.org')).toBe(owner);
    // Verifying clears every other account's pending claim on the name.
    expect(await domainOf(squatter)).toBeNull();
    const rows = await (await harness.db()).query<{ user_id: string }>('SELECT user_id FROM custom_domains WHERE hostname = $1', ['blog.example.org']);
    expect(rows.rows.map((r) => r.user_id)).toEqual([owner]);
  });

  it('refuses a VERIFIED hostname to everyone else, at attach and at verify', async () => {
    const owner = await account('verifiedholder');
    const late = await account('latecomer');
    const racer = await account('racer');
    // Two pending claims; the second one's verify races the first.
    const domain = await attached(owner, 'blog.example.org');
    const racing = await attached(racer, 'blog.example.org');
    await verifyDomain(owner, 'blog.example.org', followed('blog.example.org', domain.txtValue));
    expect(await attachDomain(late, 'blog.example.org')).toEqual({ error: 'taken' });
    // The racer's pending row is gone, so its verify finds nothing to verify.
    expect(await verifyDomain(racer, 'blog.example.org', followed('blog.example.org', racing.txtValue))).toEqual({ error: 'not_found' });
    // Even if a pending row survives beside a verified one, verifying it is refused.
    await (await harness.db()).query("INSERT INTO custom_domains (hostname, user_id, token, status) VALUES ($1, $2, $3, 'pending')", ['blog.example.org', racer, racing.txtValue]);
    expect(await verifyDomain(racer, 'blog.example.org', followed('blog.example.org', racing.txtValue))).toEqual({ error: 'taken' });
    expect(await ownerForHost('blog.example.org')).toBe(owner);
  });

  it('holds one domain per account: the same name again is the same answer, a second name is `limit`', async () => {
    const user = await account('onlyone');
    const first = await attached(user, 'one.example.org');
    expect(await attachDomain(user, 'one.example.org')).toMatchObject({ hostname: 'one.example.org', txtValue: first.txtValue });
    expect(await attachDomain(user, 'two.example.org')).toEqual({ error: 'limit' });
  });
});

describe('verifying', () => {
  it('turns a pending domain verified when the TXT, the routing and CAA all agree, following a CNAME to our address', async () => {
    const user = await account('verifies');
    const domain = await attached(user, 'blog.example.org');
    const verified = await verifyDomain(user, 'blog.example.org', followed('blog.example.org', domain.txtValue));
    expect(verified).toMatchObject({ hostname: 'blog.example.org', status: 'verified' });
    expect(await ownerForHost('blog.example.org')).toBe(user);
    expect(await ownerForHost('BLOG.example.org')).toBe(user);
    expect(await isServable('blog.example.org')).toBe(true);
    expect(await verifiedHostOf(user)).toBe('blog.example.org');
  });

  it('accepts a TXT record among others, and an address set that merely intersects ours (ALIAS, A plus AAAA)', async () => {
    const user = await account('intersects');
    const domain = await attached(user, 'example.org');
    const resolver = fixture({
      txt: { '_artifactbin.example.org': ['v=spf1 -all', domain.txtValue] },
      addresses: { 'domains.example.test': [TARGET_IP, '2001:db8::10'], 'example.org': ['2001:db8::10', '198.51.100.99'] },
    });
    expect(await verifyDomain(user, 'example.org', resolver)).toMatchObject({ status: 'verified' });
  });

  it('names the FIRST failing check: txt_missing, then not_pointing, then caa_blocks', async () => {
    const user = await account('fails');
    const domain = await attached(user, 'blog.example.org');
    const host = 'blog.example.org';
    expect(await verifyDomain(user, host, fixture({ addresses: { 'domains.example.test': [TARGET_IP], [host]: [TARGET_IP] } }))).toEqual({ error: 'txt_missing' });
    expect(await verifyDomain(user, host, fixture({ txt: { [`_artifactbin.${host}`]: ['someone-elses-token'] }, addresses: { 'domains.example.test': [TARGET_IP], [host]: [TARGET_IP] } }))).toEqual({ error: 'txt_missing' });
    // Proxied through the customer's own Cloudflare: it resolves to THEM, not us.
    expect(await verifyDomain(user, host, fixture({ txt: { [`_artifactbin.${host}`]: [domain.txtValue] }, addresses: { 'domains.example.test': [TARGET_IP], [host]: ['104.16.0.1'] } }))).toEqual({ error: 'not_pointing' });
    // A target that resolves to nothing cannot be pointed at.
    expect(await verifyDomain(user, host, fixture({ txt: { [`_artifactbin.${host}`]: [domain.txtValue] }, addresses: { [host]: [TARGET_IP] } }))).toEqual({ error: 'not_pointing' });
    // CAA on the parent applies to the child when the child has none (RFC 8659 climbs the tree).
    expect(await verifyDomain(user, host, followed(host, domain.txtValue, { caa: { 'example.org': [{ tag: 'issue', value: 'digicert.com' }] } }))).toEqual({ error: 'caa_blocks' });
    expect(await verifyDomain(user, host, followed(host, domain.txtValue, { caa: { [host]: [{ tag: 'issue', value: ';' }] } }))).toEqual({ error: 'caa_blocks' });
    expect(await domainOf(user)).toMatchObject({ status: 'pending' });
    expect(await ownerForHost(host)).toBeNull();
  });

  it('passes a CAA set that names Let\'s Encrypt, and one that only restricts wildcards or reporting', async () => {
    const user = await account('caaok');
    const domain = await attached(user, 'blog.example.org');
    const caa = { 'blog.example.org': [{ tag: 'issue', value: 'digicert.com' }, { tag: 'issue', value: 'letsencrypt.org; validationmethods=http-01' }] };
    expect(await verifyDomain(user, 'blog.example.org', followed('blog.example.org', domain.txtValue, { caa }))).toMatchObject({ status: 'verified' });
    const other = await account('caawild');
    const second = await attached(other, 'news.example.net');
    const wild = { 'example.net': [{ tag: 'issuewild', value: ';' }, { tag: 'iodef', value: 'mailto:ops@example.net' }] };
    expect(await verifyDomain(other, 'news.example.net', followed('news.example.net', second.txtValue, { caa: wild }))).toMatchObject({ status: 'verified' });
  });

  it('is refused with `disabled` while the flag is unset, and a pending domain waits', async () => {
    const user = await account('verifyoff');
    const domain = await attached(user, 'blog.example.org');
    settings.target = null;
    const resolver = followed('blog.example.org', domain.txtValue);
    expect(await verifyDomain(user, 'blog.example.org', resolver)).toEqual({ error: 'disabled' });
    expect(resolver.asked).toEqual([]);
    expect(await domainOf(user)).toMatchObject({ status: 'pending' });
  });

  it('verifies only the caller\'s own domain', async () => {
    const owner = await account('ownsit');
    const other = await account('notmine');
    const domain = await attached(owner, 'blog.example.org');
    expect(await verifyDomain(other, 'blog.example.org', followed('blog.example.org', domain.txtValue))).toEqual({ error: 'not_found' });
    expect(await ownerForHost('blog.example.org')).toBeNull();
  });
});

describe('removing, serving and the flag', () => {
  it('removes a domain whatever the flag says, and the name stops being served and becomes free', async () => {
    const owner = await account('remover');
    const domain = await attached(owner, 'blog.example.org');
    await verifyDomain(owner, 'blog.example.org', followed('blog.example.org', domain.txtValue));
    settings.target = null;
    // Serving and the ask check ignore the flag.
    expect(await ownerForHost('blog.example.org')).toBe(owner);
    expect(await isServable('blog.example.org')).toBe(true);
    expect(await domainOf(owner)).toMatchObject({ status: 'verified' });
    expect(await removeDomain(owner)).toBe(true);
    expect(await removeDomain(owner)).toBe(false);
    expect(await ownerForHost('blog.example.org')).toBeNull();
    expect(await isServable('blog.example.org')).toBe(false);
    settings.target = 'domains.example.test';
    expect(await attached(await account('nextowner'), 'blog.example.org')).toMatchObject({ status: 'pending' });
  });

  it('answers nothing for a malformed or unknown host rather than throwing', async () => {
    expect(await ownerForHost('')).toBeNull();
    expect(await ownerForHost('localhost')).toBeNull();
    expect(await ownerForHost('203.0.113.7')).toBeNull();
    expect(await isServable('nobody.example.org')).toBe(false);
    expect(await isServable('a b')).toBe(false);
  });

  it('goes with the account: erasing a test user erases its domain', async () => {
    const token = await mintToken('parent');
    const parent = await createUser({ email: 'parent@example.com' });
    await claimToken(parent.id, token.token);
    const minted = await createTestUser({ tokenId: token.id, userId: parent.id });
    if (!minted.ok) throw new Error(minted.message);
    const domain = await attached(minted.id, 'tester.example.org');
    await verifyDomain(minted.id, 'tester.example.org', followed('tester.example.org', domain.txtValue));
    await eraseTestUser(minted.id);
    const rows = await (await harness.db()).query('SELECT hostname FROM custom_domains');
    expect(rows.rows).toEqual([]);
  });
});

describe('the daily re-check', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('marks a verified domain missing when its TXT is gone, detaches it after three days, and a return clears the clock', async () => {
    const owner = await account('lapses');
    const domain = await attached(owner, 'blog.example.org');
    await verifyDomain(owner, 'blog.example.org', followed('blog.example.org', domain.txtValue));
    const gone = fixture();
    const present = followed('blog.example.org', domain.txtValue);
    const t0 = new Date('2026-09-01T00:00:00Z');

    expect(await recheckDomains(gone, t0)).toEqual({ checked: 1, missing: 1, detached: 0 });
    expect((await domainOf(owner))?.missingSince).not.toBeNull();
    // Still served while it is only missing.
    expect(await ownerForHost('blog.example.org')).toBe(owner);
    // It came back: the clock clears.
    expect(await recheckDomains(present, new Date(t0.getTime() + DAY))).toEqual({ checked: 1, missing: 0, detached: 0 });
    expect((await domainOf(owner))?.missingSince).toBeNull();

    const t1 = new Date(t0.getTime() + 2 * DAY);
    expect(await recheckDomains(gone, t1)).toMatchObject({ missing: 1, detached: 0 });
    expect(await recheckDomains(gone, new Date(t1.getTime() + 2 * DAY))).toMatchObject({ missing: 1, detached: 0 });
    expect(await recheckDomains(gone, new Date(t1.getTime() + 3 * DAY))).toMatchObject({ detached: 1 });
    expect(await domainOf(owner)).toBeNull();
    expect(await isServable('blog.example.org')).toBe(false);
  });

  it('runs with the flag off, checks only the TXT of verified rows, and asks DNS nothing when there are none', async () => {
    const pendingOwner = await account('stillpending');
    await attached(pendingOwner, 'pending.example.org');
    settings.target = null;
    const quiet = fixture();
    expect(await recheckDomains(quiet, new Date())).toEqual({ checked: 0, missing: 0, detached: 0 });
    expect(quiet.asked).toEqual([]);
    expect(await domainOf(pendingOwner)).toMatchObject({ status: 'pending' });

    settings.target = 'domains.example.test';
    const owner = await account('flagoffcheck');
    const domain = await attached(owner, 'blog.example.org');
    await verifyDomain(owner, 'blog.example.org', followed('blog.example.org', domain.txtValue));
    settings.target = null;
    const resolver = followed('blog.example.org', domain.txtValue);
    expect(await recheckDomains(resolver, new Date())).toEqual({ checked: 1, missing: 0, detached: 0 });
    expect(resolver.asked).toEqual(['txt:_artifactbin.blog.example.org']);
  });
});
