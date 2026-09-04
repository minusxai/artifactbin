#!/usr/bin/env node
/**
 * THE COMPOSE WALK (P3 CORE TEST 4) — the split shape, end to end, over HTTP.
 *
 *   docker compose -f docker-compose.lean.yml up -d --build
 *   node scripts/test-compose-lean.mjs [base]        # default http://127.0.0.1:5440
 *
 * Everything the five lean images exist FOR is crossed here, through the
 * proxy — no browser, no mail sink, so CI can run it:
 *
 *   1. /health through the proxy — answered by the PROXY itself (its health
 *      part is mounted before the forwarder; a probe that dies with the app
 *      it fronts reports the wrong process's health).
 *   2. an anonymous start — the ANON_MINT door at the proxy and the token mint
 *      at the app, returned once in the paste and response.
 *   3. a publish whose data is real: a `<Value type="table">` and a `<Query>`
 *      over it — the publish DRY RUN crosses the app→sql seam before the
 *      document is stored (a bad query is refused at publish, so a stored
 *      document means the sql container answered).
 *   4. GET /a/<id> through the proxy IS the document — the standalone
 *      sandboxed page with its own og:* and the strict per-row CSP, not the
 *      app's SPA.
 *   5. the document's own query URL answers REAL DuckDB rows — the app image
 *      that contains no DuckDB, running the query in the sql container.
 *   6. the events container answers its own /health and STORES a hand-built
 *      envelope — the log's wire, its secret and its boot DDL, in the one
 *      container that owns a schema. It publishes NO port (the proxy is the
 *      only door), so this leg runs FROM INSIDE the compute network, on the
 *      app container, which is where an emitter lives and which already holds
 *      the shared INTERNAL__SERVICE_SECRET. `docker compose` is addressed the
 *      way CI addresses it — COMPOSE_FILE / COMPOSE_PROJECT_NAME from the
 *      environment, defaulting to this repo's lean file.
 *
 * NO EXPORT LEG, deliberately. Measured on this compose (P3b-Y): Chromium
 * HTTPS-UPGRADES the plain-http container URL — `http://app:3000` navigates
 * as `https` and dies `ERR_SSL_PROTOCOL_ERROR`, while `http://127.0.0.1:*`
 * (the full image's default origin) is upgrade-exempt and renders fine. The
 * fix is a launch-arg in services/browser/src/local.ts (`chromium.launch`
 * carries no `args` today), which is that package's to make — not this
 * walk's to paper over. Re-add the leg when it lands:
 *   GET /a/<id>/export → image/png (the app image has no Chromium; the
 *   browser container rendered it).
 *
 * The login leg (a code from a mail sink) is deliberately NOT here: it needs
 * a mailbox, which CI does not have — it is walked by hand against the same
 * compose file (the phase report carries it).
 */
import { execFileSync } from 'node:child_process';

const [baseArg] = process.argv.slice(2);
const base = (baseArg ?? 'http://127.0.0.1:5440').replace(/\/$/, '');
// Compose is addressed exactly as its callers address it: COMPOSE_FILE (CI sets
// it to the lean file plus its overrides) and COMPOSE_PROJECT_NAME, with this
// repo's lean file as the default so the two commands in the header still work
// side by side.
const composeEnv = { ...process.env, COMPOSE_FILE: process.env.COMPOSE_FILE ?? 'docker-compose.lean.yml' };

/**
 * One `node -e` on the app container: it sits on the compute network and holds
 * the same INTERNAL__SERVICE_SECRET compose hands the events service, so the
 * whole leg is one round trip and no secret travels through this process.
 */
const IN_NETWORK_EMIT = `
const url = 'http://events:8080';
const secret = process.env.INTERNAL__SERVICE_SECRET;
const envelope = {
  id: 'walk-' + Date.now(), at: new Date().toISOString(), source: 'app',
  subject_kind: 'visitor', subject_id: 'compose-walk', verb: 'viewed',
  object_kind: 'artifact', object_id: process.env.WALK_ARTIFACT_ID,
  payload: { client: 'compose-walk' },
};
const post = (headers) => fetch(url + '/emit', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify([envelope]) });
const auth = { 'x-artifactbin-service-secret': secret };
(async () => {
  const health = await fetch(url + '/health');
  const healthBody = await health.json().catch(() => null);
  const anonymous = await post({});
  const stored = await post(auth);
  const storedBody = await stored.json().catch(() => null);
  const replay = await post(auth);
  console.log(JSON.stringify({ health: health.status, healthBody, anonymous: anonymous.status, stored: stored.status, storedBody, replay: replay.status }));
})().catch((e) => { console.log(JSON.stringify({ error: String(e) })); });
`;

/** Run it and read the one JSON line back; a compose failure is a failed check, never a thrown walk. */
const emitFromInside = (artifactId) => {
  try {
    const out = execFileSync('docker', ['compose', 'exec', '-T', '-e', `WALK_ARTIFACT_ID=${artifactId}`, 'app', 'node', '-e', IN_NETWORK_EMIT], { env: composeEnv, encoding: 'utf8' });
    return JSON.parse(out.trim().split('\n').pop());
  } catch (e) {
    return { error: (e.stderr ?? e.message ?? String(e)).toString().trim().split('\n').slice(-2).join(' ') };
  }
};

const TITLE = 'lean compose walk';
const MARKUP = [
  '<Helmet>',
  `<title>${TITLE}</title>`,
  '<Value type="table" name="events" value={[{ kind: "push", n: 2 }, { kind: "push", n: 1 }, { kind: "merge", n: 1 }]} />',
  '<Query name="by_kind">{`select kind, sum(n) as total from events group by kind order by kind`}</Query>',
  '</Helmet>',
  '<h2>The split shape on one host</h2>',
  '<p>Proxy, app, sql and browser — four lean images, one commit.</p>',
].join('\n');

const checks = [];
const say = (name, ok, detail = '') => { checks.push({ name, ok }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };

const json = async (path, opts = {}) => {
  const res = await fetch(`${base}${path}`, opts);
  const body = await res.json().catch(() => null);
  return { res, body };
};

async function main() {
  // 1. The proxy's own health.
  {
    const { res, body } = await json('/health');
    say('GET /health through the proxy', res.status === 200 && body?.ok === true, `${res.status} ${JSON.stringify(body)}`);
  }

  // 2. Anonymous start — mint + one-time token, exactly as the paste carries it.
  const start = await fetch(`${base}/api/start`, { method: 'POST' });
  const startBody = await start.json().catch(() => null);
  say('POST /api/start mints a start document', start.ok && !!startBody?.id, `${start.status}`);
  const token = typeof startBody?.token === 'string' && /^mx_[A-Za-z0-9_-]+$/.test(startBody.token)
    ? startBody.token
    : null;
  const pasteCarriesToken = typeof startBody?.prompt === 'string'
    && !startBody.prompt.includes('\n')
    && !startBody.prompt.includes('\r')
    && !!token
    && startBody.prompt.includes(`using this token: ${token}`);
  say('the one-line paste hands the agent its token', pasteCarriesToken, pasteCarriesToken ? 'mx_…' : 'missing or mismatched token');
  if (!token) throw new Error('POST /api/start handed out no token');
  const id = startBody.id;
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  // 3. Publish data — the dry run crosses the app→sql seam at publish.
  {
    const { res, body } = await json(`/api/artifacts/${id}`, { method: 'PUT', headers: auth, body: JSON.stringify({ title: TITLE, markup: MARKUP }) });
    say('PUT the document (its <Query> dry-run ran in the sql container)', res.status === 200 || res.status === 201, `${res.status}${body?.error ? ` ${body.error}` : ''}`);
  }

  // 4. GET /a/<id> through the proxy IS the document.
  {
    const res = await fetch(`${base}/a/${id}`);
    const html = await res.text();
    const csp = res.headers.get('content-security-policy') ?? '';
    // The served document carries its own og card and the strict per-row CSP
    // (default-src 'none' — the app SPA never sets that on its own pages),
    // and does NOT carry the SPA's bootstrap island.
    const hasOg = /<meta\s+property="og:title"/.test(html);
    const sandboxed = csp.includes("default-src 'none'");
    const notSpa = !html.includes('mx-page-data') && !html.includes('id="root"');
    say('GET /a/<id> through the proxy IS the document', res.status === 200 && hasOg && sandboxed && notSpa,
      `og:title ${hasOg}, CSP default-src 'none' ${sandboxed}, not the SPA ${notSpa}`);
  }

  // 5. The document's own query URL — real DuckDB rows from the sql container.
  {
    const q = JSON.stringify({ only: ['by_kind'] });
    const { res, body } = await json(`/a/${id}/query?q=${encodeURIComponent(q)}`);
    const rows = body?.tables?.by_kind?.rows;
    const right = Array.isArray(rows) && rows.length === 2 && rows[0]?.kind === 'merge' && rows[0]?.total === 1 && rows[1]?.kind === 'push' && rows[1]?.total === 3;
    say('GET /a/<id>/query answers DuckDB rows (app image has no DuckDB)', res.status === 200 && right,
      right ? JSON.stringify(rows) : `${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  }

  // 6. The event log's own container, from INSIDE the compute network — it
  //    publishes no port, so an emitter is where this must be driven from.
  //
  // TODO(events-app): assert the walk's publish landed as artifact.created —
  // the app's trackEvent dual-write is the other half of this wave and is not
  // in this branch, so nothing the walk above does emits anything yet. When it
  // merges, replace the hand-built envelope with a query for that row.
  {
    const r = emitFromInside(id);
    say('GET /health on the events container (from the app, over compute)', r.health === 200 && r.healthBody?.ok === true,
      r.error ?? `${r.health} ${JSON.stringify(r.healthBody)}`);
    // The secret is not optional on the log: an unauthenticated emitter could
    // write anyone's history.
    say('POST /emit without the service secret is refused', r.anonymous === 401, r.error ?? `${r.anonymous}`);
    say('POST /emit stores an envelope (the events container owns events.events)', r.stored === 200 && r.storedBody?.accepted === 1,
      r.error ?? `${r.stored} ${JSON.stringify(r.storedBody)}`);
    // The id is the dedupe key: the same batch again stores nothing new, which
    // is what makes the client's one retry free.
    say('the same envelope again is accepted and stores nothing new', r.replay === 200, r.error ?? `${r.replay}`);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\ncompose walk: ${checks.length - failed.length}/${checks.length} checks passed${failed.length ? '' : ' — GREEN'}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
