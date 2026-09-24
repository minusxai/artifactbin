/**
 * CUSTOM DOMAINS — one hostname an ACCOUNT serves its public documents at.
 *
 * Every rule lives here; routes and the host boundary (server/app) only
 * translate these answers to HTTP.
 *
 *  - An account attaches ONE hostname (a subdomain or a bare domain). The row
 *    belongs to the account id, never the username, so a rename moves nothing.
 *  - Attaching and verifying are gated by FLAG__CUSTOM_DOMAINS (lib/config
 *    CUSTOM_DOMAINS_TARGET, the DNS target hostname). Serving, the certificate
 *    ask check, the daily re-check and removal IGNORE it: turning the flag off
 *    must never break a live domain or lock an owner into one.
 *  - Verification is three DNS facts, checked in order, the first failure
 *    named: the TXT at `_artifactbin.<host>` carries this account's token; the
 *    hostname resolves (through any CNAME/ALIAS) to an address our target
 *    resolves to; and no CAA record forbids Let's Encrypt.
 *  - A verified row's TXT is re-checked daily. Missing starts a clock; three
 *    days of it detach the row, and its return clears the clock.
 *
 * DNS goes through a {@link DomainResolver}: the default asks node's resolver,
 * tests hand in a fixture. Nothing here holds a transaction across a lookup.
 */
import { createHmac } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ALIAS_ORIGINS, ASSETS_ORIGIN, AUTH_SECRET, CUSTOM_DOMAINS_TARGET, PUBLIC_BASE_URL } from '@/lib/config';
import { canReadArtifact, LIVE_ARTIFACT_SQL, type ArtifactRow } from '@/lib/artifacts';
import { urlHash } from '@/lib/story/asset-url';
import { collectExternalAssetUrls } from '@/lib/story/external-images';
import { getDb } from '@/lib/db';
import { canonicalArtifactPath, domainPostPath } from '@/lib/urls';
import { ownerUsername } from '@/lib/users';

export type DomainStatus = 'pending' | 'verified';
/** One CAA property, as `tag value` (`issue letsencrypt.org`). `critical` is the issuer-critical flag. */
export interface CaaRecord { tag: string; value: string; critical?: boolean }
/** The three DNS questions verification asks. Every method answers `[]` for a name with no such records. */
export interface DomainResolver {
  /** TXT records at `name`, each record's strings joined. */
  txt(name: string): Promise<string[]>;
  /** A and AAAA addresses `name` resolves to, after any CNAME/ALIAS. */
  addresses(name: string): Promise<string[]>;
  /** CAA records at exactly `name` (the climb is ours). */
  caa(name: string): Promise<CaaRecord[]>;
}

export interface AttachedDomain {
  hostname: string;
  status: DomainStatus;
  /** The TXT record's name and value that prove this account holds the hostname. */
  txtName: string;
  txtValue: string;
  /** Where to point the hostname (CNAME/ALIAS, or A to its address); null while the flag is off. */
  target: string | null;
  verifiedAt: string | null;
  missingSince: string | null;
}
export type AttachRefusal = 'disabled' | 'invalid_hostname' | 'taken' | 'limit';
export type VerifyRefusal = 'disabled' | 'not_found' | 'taken' | 'txt_missing' | 'not_pointing' | 'caa_blocks';

/** The TXT record's label; the name we ask for is `_artifactbin.<hostname>`. */
export const TXT_LABEL = '_artifactbin';
/** How long a verified domain's TXT may be missing before the re-check detaches it. */
export const DETACH_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
/** How often the app server re-checks verified domains. */
export const RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** The CA whose certificates the custom-domain edge issues. */
const OUR_CA = 'letsencrypt.org';

interface DomainRow {
  hostname: string;
  user_id: string;
  token: string;
  status: DomainStatus;
  verified_at: Date | string | null;
  missing_since: Date | string | null;
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * The one spelling of a hostname: trimmed, lowercase, without a trailing dot.
 * Null when it is not a DNS name with at least two labels — a port, an IP
 * address, a scheme, a path, a wildcard or an all-numeric top label.
 */
export function normalizeHostname(input: string): string | null {
  const host = input.trim().toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253 || isIP(host)) return null;
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return null;
  if (!/[a-z]/.test(labels[labels.length - 1]!)) return null;
  return host;
}

const hostOf = (origin: string | null | undefined): string | null => {
  if (!origin) return null;
  try { return new URL(origin).hostname.toLowerCase(); } catch { return null; }
};

/**
 * Names that are ours: the app, its aliases, the assets host and the DNS
 * target. Read at call time, never cached, so the answer follows the config.
 */
function ownHosts(): string[] {
  return [hostOf(PUBLIC_BASE_URL), ...ALIAS_ORIGINS.map(hostOf), hostOf(ASSETS_ORIGIN), CUSTOM_DOMAINS_TARGET]
    .filter((host): host is string => !!host);
}

/**
 * Ours, or under ours. A single-label host (`localhost`) is not a zone we hold
 * names under, so only a dotted host of ours claims its subdomains.
 */
function isOwnHost(host: string): boolean {
  return ownHosts().some((own) => host === own || (own.includes('.') && host.endsWith(`.${own}`)));
}

/** Per ACCOUNT, derived: a record proving one account can never prove another, and re-attaching keeps it. */
function tokenFor(userId: string): string {
  return `artifactbin-verify=${createHmac('sha256', AUTH_SECRET).update(`custom-domain:${userId}`).digest('hex').slice(0, 32)}`;
}

const txtNameFor = (hostname: string): string => `${TXT_LABEL}.${hostname}`;
const isoOrNull = (value: Date | string | null): string | null =>
  value === null ? null : (value instanceof Date ? value : new Date(value)).toISOString();

function view(row: DomainRow): AttachedDomain {
  return {
    hostname: row.hostname,
    status: row.status,
    txtName: txtNameFor(row.hostname),
    txtValue: row.token,
    target: CUSTOM_DOMAINS_TARGET,
    verifiedAt: isoOrNull(row.verified_at),
    missingSince: isoOrNull(row.missing_since),
  };
}

const COLUMNS = 'hostname, user_id, token, status, verified_at, missing_since';

async function rowForUser(userId: string): Promise<DomainRow | null> {
  const db = await getDb();
  return (await db.query<DomainRow>(`SELECT ${COLUMNS} FROM custom_domains WHERE user_id = $1`, [userId])).rows[0] ?? null;
}

/** The VERIFIED row for a hostname — the only row that holds the name. */
async function verifiedRowForHost(hostname: string): Promise<DomainRow | null> {
  const db = await getDb();
  return (await db.query<DomainRow>(`SELECT ${COLUMNS} FROM custom_domains WHERE hostname = $1 AND status = 'verified'`, [hostname])).rows[0] ?? null;
}

const isUniqueViolation = (error: unknown): boolean => (error as { code?: string }).code === '23505';

/** The account's domain, pending or verified — what the settings page shows. */
export async function domainOf(userId: string): Promise<AttachedDomain | null> {
  const row = await rowForUser(userId);
  return row ? view(row) : null;
}

/**
 * Attach `hostname` to the account as PENDING. The same hostname again is the
 * same answer; any other name while one is attached is `limit`. Only a
 * VERIFIED hostname is `taken`: a pending claim holds nothing, so nobody can
 * squat a name by attaching it and never verifying — several accounts may
 * wait on the same name, and only the one whose TXT token is in DNS verifies.
 */
export async function attachDomain(userId: string, hostname: string): Promise<AttachedDomain | { error: AttachRefusal }> {
  if (!CUSTOM_DOMAINS_TARGET) return { error: 'disabled' };
  const host = normalizeHostname(hostname);
  if (!host || isOwnHost(host)) return { error: 'invalid_hostname' };
  const settle = async (): Promise<AttachedDomain | { error: AttachRefusal }> => {
    const mine = await rowForUser(userId);
    if (mine) return mine.hostname === host ? view(mine) : { error: 'limit' };
    return { error: 'taken' };
  };
  const mine = await rowForUser(userId);
  if (mine) return mine.hostname === host ? view(mine) : { error: 'limit' };
  if (await verifiedRowForHost(host)) return { error: 'taken' };
  const db = await getDb();
  try {
    const inserted = await db.query<DomainRow>(
      `INSERT INTO custom_domains (hostname, user_id, token, status) VALUES ($1, $2, $3, 'pending') RETURNING ${COLUMNS}`,
      [host, userId, tokenFor(userId)],
    );
    return view(inserted.rows[0]!);
  } catch (error) {
    // A concurrent attach took this account's one slot.
    if (isUniqueViolation(error)) return settle();
    throw error;
  }
}

/** RFC 8659: the relevant CAA set is the first one found climbing from the name toward the root. */
async function caaForbidsUs(hostname: string, resolver: DomainResolver): Promise<boolean> {
  const labels = hostname.split('.');
  for (let i = 0; i < labels.length; i++) {
    const records = await resolver.caa(labels.slice(i).join('.'));
    if (!records.length) continue;
    const known = new Set(['issue', 'issuewild', 'iodef', 'contactemail', 'contactphone']);
    if (records.some((r) => r.critical && !known.has(r.tag.toLowerCase()))) return true;
    const issuers = records.filter((r) => r.tag.toLowerCase() === 'issue');
    if (!issuers.length) return false;
    return !issuers.some((r) => (r.value.split(';')[0] ?? '').trim().toLowerCase() === OUR_CA);
  }
  return false;
}

async function holdsToken(row: Pick<DomainRow, 'hostname' | 'token'>, resolver: DomainResolver): Promise<boolean> {
  const records = await resolver.txt(txtNameFor(row.hostname));
  return records.some((record) => record.trim() === row.token);
}

/**
 * Check the account's pending (or verified) domain and mark it verified. The
 * first failing check is the answer: `txt_missing`, `not_pointing`,
 * `caa_blocks`. A failure leaves the row as it was. A name another account
 * has already verified is `taken`. Success clears every OTHER account's
 * pending claim on the name, in the same transaction, after the DNS is asked.
 */
export async function verifyDomain(userId: string, hostname: string, resolver: DomainResolver): Promise<AttachedDomain | { error: VerifyRefusal }> {
  const target = CUSTOM_DOMAINS_TARGET;
  if (!target) return { error: 'disabled' };
  const host = normalizeHostname(hostname);
  const row = host ? await rowForUser(userId) : null;
  if (!row || row.hostname !== host) return { error: 'not_found' };

  if (!(await holdsToken(row, resolver))) return { error: 'txt_missing' };
  const [ours, theirs] = await Promise.all([resolver.addresses(target), resolver.addresses(row.hostname)]);
  const ourSet = new Set(ours.map((a) => a.toLowerCase()));
  if (!theirs.some((a) => ourSet.has(a.toLowerCase()))) return { error: 'not_pointing' };
  if (await caaForbidsUs(row.hostname, resolver)) return { error: 'caa_blocks' };

  const db = await getDb();
  try {
    const verified = await db.transaction(async (tx) => {
      const held = await tx.query<{ user_id: string }>(`SELECT user_id FROM custom_domains WHERE hostname = $1 AND status = 'verified' AND user_id <> $2`, [row.hostname, userId]);
      if (held.rows.length) return 'taken' as const;
      const updated = await tx.query<DomainRow>(
        `UPDATE custom_domains SET status = 'verified', verified_at = COALESCE(verified_at, now()), missing_since = NULL
         WHERE hostname = $1 AND user_id = $2 RETURNING ${COLUMNS}`,
        [row.hostname, userId],
      );
      // Removed while DNS was being asked: there is nothing left to verify.
      if (!updated.rows[0]) return null;
      await tx.query(`DELETE FROM custom_domains WHERE hostname = $1 AND user_id <> $2 AND status = 'pending'`, [row.hostname, userId]);
      return updated.rows[0];
    });
    if (verified === 'taken') return { error: 'taken' };
    return verified ? view(verified) : { error: 'not_found' };
  } catch (error) {
    // A concurrent verify of the same name won the one verified slot (the partial unique index).
    if (isUniqueViolation(error)) return { error: 'taken' };
    throw error;
  }
}

/** Detach the account's domain, whatever the flag says. True when there was one. */
export async function removeDomain(userId: string): Promise<boolean> {
  const db = await getDb();
  const removed = await db.query<{ hostname: string }>('DELETE FROM custom_domains WHERE user_id = $1 RETURNING hostname', [userId]);
  return removed.rows.length > 0;
}

/**
 * Could this request host ever be a custom domain? The normalized name when it
 * could; null for our own hosts, an IP, a single label (`localhost`) or
 * garbage — so the app's own traffic never costs a lookup.
 */
export function customHostCandidate(hostname: string): string | null {
  const host = normalizeHostname(hostname);
  return host && !isOwnHost(host) ? host : null;
}

/** Which account a VERIFIED hostname serves; null for anything else, including a malformed host. */
export async function ownerForHost(hostname: string): Promise<string | null> {
  const host = normalizeHostname(hostname);
  if (!host) return null;
  return (await verifiedRowForHost(host))?.user_id ?? null;
}

/** The certificate ask check: may the edge obtain a certificate for this name? Verified only; flag ignored. */
export async function isServable(hostname: string): Promise<boolean> {
  return (await ownerForHost(hostname)) !== null;
}

/** The account's VERIFIED hostname, for the canonical link on its artifactbin copies. */
export async function verifiedHostOf(userId: string): Promise<string | null> {
  const row = await rowForUser(userId);
  return row?.status === 'verified' ? row.hostname : null;
}

/**
 * The daily safety check, flag or no flag: re-read the TXT of every VERIFIED
 * row. Missing starts `missing_since`; missing for {@link DETACH_AFTER_MS}
 * detaches the row; present again clears the clock. Pending rows are not asked.
 */
export async function recheckDomains(resolver: DomainResolver, now: Date = new Date()): Promise<{ checked: number; missing: number; detached: number }> {
  const db = await getDb();
  const rows = (await db.query<DomainRow>(`SELECT ${COLUMNS} FROM custom_domains WHERE status = 'verified' ORDER BY hostname`)).rows;
  let missing = 0;
  let detached = 0;
  for (const row of rows) {
    let present: boolean;
    try { present = await holdsToken(row, resolver); } catch { continue; }
    if (present) {
      if (row.missing_since !== null) await db.query('UPDATE custom_domains SET missing_since = NULL WHERE user_id = $1', [row.user_id]);
      continue;
    }
    if (row.missing_since === null) {
      await db.query('UPDATE custom_domains SET missing_since = $2 WHERE user_id = $1 AND missing_since IS NULL', [row.user_id, now.toISOString()]);
      missing++;
      continue;
    }
    const since = new Date(row.missing_since).getTime();
    if (now.getTime() - since >= DETACH_AFTER_MS) {
      const gone = await db.query('DELETE FROM custom_domains WHERE hostname = $1 AND user_id = $2 AND missing_since IS NOT NULL RETURNING hostname', [row.hostname, row.user_id]);
      detached += gone.rows.length;
    } else {
      missing++;
    }
  }
  return { checked: rows.length, missing, detached };
}

/**
 * Node's own resolver, bounded: a lookup that hangs must not hang a Verify
 * press. Every "no such record" shape answers `[]`.
 */
export function defaultDomainResolver(): DomainResolver {
  const resolver = new Resolver({ timeout: 5000, tries: 2 });
  const none = <T>(promise: Promise<T[]>): Promise<T[]> => promise.catch(() => []);
  return {
    txt: async (name) => (await none(resolver.resolveTxt(name))).map((chunks) => chunks.join('')),
    addresses: async (name) => {
      const [v4, v6] = await Promise.all([none(resolver.resolve4(name)), none(resolver.resolve6(name))]);
      return [...v4, ...v6];
    },
    caa: async (name) => (await none(resolver.resolveCaa(name))).flatMap((record) => {
      const { critical, ...properties } = record as unknown as Record<string, unknown> & { critical: number };
      return Object.entries(properties)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .map(([tag, value]) => ({ tag, value, critical: (critical & 128) !== 0 }));
    }),
  };
}

let resolverOverride: DomainResolver | null = null;
/** The resolver routes use. Tests replace it with a fixture; null restores node's. */
export function setDomainResolver(resolver: DomainResolver | null): void { resolverOverride = resolver; }
export function domainResolver(): DomainResolver { return resolverOverride ?? defaultDomainResolver(); }

/**
 * Run the re-check at boot and every {@link RECHECK_INTERVAL_MS}, on an
 * unref'd timer so it never keeps a process alive. With no verified rows it
 * asks DNS nothing. Returns the stop the host's close awaits.
 */
export function startDomainRecheck(resolve: () => DomainResolver = domainResolver, intervalMs = RECHECK_INTERVAL_MS): () => Promise<void> {
  let pending: Promise<void> | null = null;
  const tick = () => pending ??= recheckDomains(resolve())
    .then(({ missing, detached }) => { if (missing || detached) console.warn(`[custom-domains] re-check: ${missing} missing, ${detached} detached`); })
    .catch((error) => { console.error('[custom-domains] re-check failed:', error); })
    .finally(() => { pending = null; });
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  void tick();
  return async () => { clearInterval(timer); await pending; };
}

// ── What a verified host serves ─────────────────────────────────────────────

/** A document the host may serve: the owner's, PUBLIC, a markup document, not in the trash. */
export function servesDocument(ownerId: string, row: Pick<ArtifactRow, 'user_id' | 'visibility' | 'format'> & { deleted_at?: unknown }): boolean {
  return row.user_id === ownerId && row.visibility === 'public' && row.format === 'markup' && !row.deleted_at;
}

/** The ref kinds a post embeds by bytes (lib/story/ref-data): `<img src="ref:…">`, a `<File>` card, a PDF. */
const EMBEDDED_FORMATS = new Set(['image', 'file', 'pdf']);
/** The owner's public, live markup documents, as the SQL both embed rules below scope to. */
const OWNER_POSTS_SQL = `user_id = $1 AND visibility = 'public' AND format = 'markup' AND ${LIVE_ARTIFACT_SQL}`;

/**
 * An uploaded image (or file, or PDF) the host may serve at `/a/<id>/raw`:
 * one of the owner's public documents REFERENCES it (`meta.refs`, what
 * publish records and refDataForRow renders from), and a guest may read it —
 * the same rule the app copy applies when a guest loads that document's
 * images. Nothing else's bytes are reachable on the host, markup included.
 */
export async function servesEmbeddedArtifact(ownerId: string, row: ArtifactRow): Promise<boolean> {
  if (!EMBEDDED_FORMATS.has(row.format) || !(await canReadArtifact(row, null))) return false;
  const db = await getDb();
  const referencing = await db.query(
    `SELECT 1 FROM artifacts WHERE ${OWNER_POSTS_SQL} AND meta->'refs' @> $2::jsonb LIMIT 1`,
    [ownerId, JSON.stringify([{ id: row.id }])],
  );
  return referencing.rows.length > 0;
}

/**
 * Our copy of a web image (`/assets/<sha of its url>`, lib/story/asset-url)
 * the host may serve: one of the owner's public documents names that URL —
 * the same URLs the serving path maps to our copies (webAssetsForSource).
 */
export async function servesWebAsset(ownerId: string, hash: string): Promise<boolean> {
  const db = await getDb();
  const posts = await db.query<{ source: string | null }>(`SELECT source FROM artifacts WHERE ${OWNER_POSTS_SQL} AND source IS NOT NULL`, [ownerId]);
  return posts.rows.some((post) => collectExternalAssetUrls(post.source!).all.some((url) => urlHash(url) === hash));
}

/** The canonical address of a post: on the custom host, over HTTPS (the edge serves nothing else). */
export function domainPostUrl(hostname: string, row: Pick<ArtifactRow, 'id' | 'title'>): string {
  return `https://${hostname}${domainPostPath(row)}`;
}

/**
 * The canonical address of a document's ARTIFACTBIN copy (the app page and
 * `/a/<id>/raw`). A public document whose owner has a verified domain is
 * canonical on that domain; everything else is canonical at its own app
 * address, on the one canonical origin (APP__PUBLIC_BASE_URL).
 */
export async function canonicalDocumentUrl(row: Pick<ArtifactRow, 'id' | 'title' | 'user_id' | 'visibility' | 'format'>): Promise<string> {
  if (row.user_id && row.visibility === 'public' && row.format === 'markup') {
    const host = await verifiedHostOf(row.user_id);
    if (host) return domainPostUrl(host, row);
  }
  return `${PUBLIC_BASE_URL.replace(/\/+$/, '')}${canonicalArtifactPath(row, await ownerUsername(row.user_id))}`;
}
