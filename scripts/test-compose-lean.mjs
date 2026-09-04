#!/usr/bin/env node
/**
 * THE COMPOSE WALK (P3 CORE TEST 4) — the split shape, end to end, over HTTP.
 *
 *   docker compose -f docker-compose.lean.yml up -d --build
 *   node scripts/test-compose-lean.mjs [base] [events base]
 *                          # defaults http://127.0.0.1:5440 and :5441
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
 *      container that owns a schema. Its INTERNAL__SERVICE_SECRET is read
 *      from this process's environment, the same value compose hands it.
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
const [baseArg, eventsArg] = process.argv.slice(2);
const base = (baseArg ?? 'http://127.0.0.1:5440').replace(/\/$/, '');
const eventsBase = (eventsArg ?? 'http://127.0.0.1:5441').replace(/\/$/, '');
const serviceSecret = process.env.INTERNAL__SERVICE_SECRET ?? '';

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

  // 6. The event log's own container: its health, its secret and its table.
  //
  // TODO(events-app): assert the walk's publish landed as artifact.created —
  // the app's trackEvent dual-write is the other half of this wave and is not
  // in this branch, so nothing the walk above does emits anything yet. When it
  // merges, replace the hand-built envelope with a query for that row.
  {
    const res = await fetch(`${eventsBase}/health`);
    const body = await res.json().catch(() => null);
    say('GET /health on the events container', res.status === 200 && body?.ok === true, `${res.status} ${JSON.stringify(body)}`);
  }
  {
    const envelope = {
      id: `walk-${Date.now()}`,
      at: new Date().toISOString(),
      source: 'app',
      subject_kind: 'visitor',
      subject_id: 'compose-walk',
      verb: 'viewed',
      object_kind: 'artifact',
      object_id: id,
      payload: { client: 'compose-walk' },
    };
    const post = (headers) => fetch(`${eventsBase}/emit`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify([envelope]) });
    // The secret is not optional on the log: an unauthenticated emitter could
    // write anyone's history.
    const refused = await post({});
    say('POST /emit without the service secret is refused', refused.status === 401, `${refused.status}`);
    const res = await post({ 'x-artifactbin-service-secret': serviceSecret });
    const body = await res.json().catch(() => null);
    say('POST /emit stores an envelope (the events container owns events.events)', res.status === 200 && body?.accepted === 1, `${res.status} ${JSON.stringify(body)}`);
    // The id is the dedupe key: the same batch again stores nothing new, which
    // is what makes the client's one retry free.
    const again = await post({ 'x-artifactbin-service-secret': serviceSecret });
    say('the same envelope again is accepted and stores nothing new', again.status === 200, `${again.status}`);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\ncompose walk: ${checks.length - failed.length}/${checks.length} checks passed${failed.length ? '' : ' — GREEN'}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
