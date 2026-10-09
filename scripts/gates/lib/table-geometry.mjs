import {fixtureFetch as fetch} from './fixture-http.mjs';
/** Short-table fit, height cap and virtualized tail, measured in Chromium. */
import { startDocument } from '../../lib/start-doc.mjs';
import { documentFrame } from './page-facts.mjs';

export async function checkTableGeometry(BASE, browser, check) {
  const CAP = 420;
  const SHORT_ROWS = 3;
  const LONG_ROWS = 500;
  const LAST_LABEL = `row-${LONG_ROWS - 1}`;

  const start = await startDocument(BASE);
  const H = { Authorization: `Bearer ${start.token}`, 'Content-Type': 'application/json' };
  const api = async (path, body, method = 'POST') => {
    const res = await fetch(`${BASE}${path}`, { method, headers: H, body: JSON.stringify(body) });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    if (!res.ok) throw new Error(`${path} → ${res.status} ${text}`);
    return parsed;
  };

  const rows = (n) => Array.from({ length: n }, (_, i) => ({ label: `row-${i}`, n: i }));
  const short = await api('/api/artifacts', { dataset: rows(SHORT_ROWS) });
  const long = await api('/api/artifacts', { dataset: rows(LONG_ROWS) });
  check(!!short.id && !!long.id, `both datasets published (${short.id}, ${long.id})`);

  const markup = `<Helmet><title>DataTable height gate</title>
  <Import name="few_data" src="ref:${short.id}" /><Query name="few">{\`select label, n from few_data.rows order by n\`}</Query>
  <Import name="many_data" src="ref:${long.id}" /><Query name="many">{\`select label, n from many_data.rows order by n\`}</Query>
  </Helmet><div data-design="tw" className="p-8"><h1 className="text-2xl font-bold">Table height</h1>
  <div id="short"><DataTable data="$few" /></div>
  <div id="long"><DataTable data="$many" height={${CAP}} /></div></div>`;
  await api(`/api/artifacts/${start.id}`, { title: 'DataTable height gate', markup }, 'PUT');

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  // The document is framed by the app page on its own origin, so the boxes are measured inside that frame.
  await page.goto(`${BASE}/a/${start.id}`, { waitUntil: 'load' });
  const doc = await documentFrame(page);
  await doc.waitForSelector('#long [data-slot="data-table"]', { timeout: 20000 });
  // The rows arrive with the page (lib/story/prepared/served-results.server) in the static regime; what is
  // measured below is the VIRTUAL one, which the runtime switches the long table to once it owns it.
  await doc.waitForFunction(
    (last) => (document.querySelector('#short tbody')?.textContent ?? '').includes('row-2')
      && (document.querySelector('#long tbody')?.querySelectorAll('tr').length ?? 0) > 5
      && document.querySelector('#long [data-mx-kit-table]')?.style.display === 'block'
      && !(document.querySelector('#long tbody')?.textContent ?? '').includes(last),
    LAST_LABEL,
    { timeout: 20000 },
  ).catch(() => {});

  const box = (id) => `#${id} [data-slot="data-table"] > div`;
  const measured = await doc.evaluate((sel) => {
    const read = (q) => {
      const el = document.querySelector(q);
      return el ? { clientHeight: el.clientHeight, scrollHeight: el.scrollHeight } : null;
    };
    return { short: read(sel.short), long: read(sel.long) };
  }, { short: box('short'), long: box('long') });
  console.log(JSON.stringify(measured, null, 1));

  check(measured.short !== null && measured.long !== null, 'both scroll boxes are in the document');
  check(
    measured.short.clientHeight > 0 && measured.short.clientHeight < 200,
    `a ${SHORT_ROWS}-row table hugs its rows (clientHeight=${measured.short.clientHeight} < 200, cap ${CAP})`,
  );
  check(
    measured.short.scrollHeight === measured.short.clientHeight,
    `…and reserves nothing below them (scrollHeight=${measured.short.scrollHeight} === clientHeight=${measured.short.clientHeight})`,
  );
  check(
    measured.long.clientHeight === CAP,
    `a ${LONG_ROWS}-row table stops AT the cap (clientHeight=${measured.long.clientHeight} === ${CAP})`,
  );
  check(
    measured.long.scrollHeight > CAP,
    `…and scrolls inside it (scrollHeight=${measured.long.scrollHeight} > ${CAP})`,
  );

  // The cap-only box must still be the virtualizer's scroll element: scroll to
  // the end and the window must follow, all the way to the dataset's last row.
  await doc.evaluate((q) => { const el = document.querySelector(q); el.scrollTop = el.scrollHeight; }, box('long'));
  await doc.waitForFunction(
    (args) => (document.querySelector(`${args.q} tbody`)?.textContent ?? '').includes(args.last),
    { q: box('long'), last: LAST_LABEL },
    { timeout: 10000 },
  ).catch(() => {});
  const tail = await doc.evaluate((q) => {
    const body = document.querySelector(`${q} tbody`);
    const trs = [...(body?.querySelectorAll('tr') ?? [])];
    const el = document.querySelector(q);
    return {
      rendered: trs.length,
      lastRowText: trs.at(-1)?.textContent ?? null,
      scrolledTo: Math.round(el.scrollTop),
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    };
  }, box('long'));
  console.log(JSON.stringify(tail, null, 1));

  check(tail.rendered > 0, `rows are still rendered at the bottom of a cap-only box (${tail.rendered} <tr>)`);
  check(
    tail.rendered < LONG_ROWS,
    `and it is still VIRTUAL — the DOM holds a window, not the table (${tail.rendered} of ${LONG_ROWS})`,
  );
  check(
    (tail.lastRowText ?? '').includes(LAST_LABEL),
    `the last rendered row is the dataset's tail (${JSON.stringify(tail.lastRowText)} contains ${LAST_LABEL})`,
  );
  check(tail.clientHeight === CAP, `the cap held through the scroll (clientHeight=${tail.clientHeight})`);
  check(pageErrors.length === 0, `no page errors (${pageErrors.length}${pageErrors.length ? `: ${pageErrors[0]}` : ''})`);

  await page.close();
  await checkVoltaCardTableWidth(BASE, browser, check);
}

/** Grid cards must bound their child while the table owns horizontal overflow. */
async function checkVoltaCardTableWidth(BASE, browser, check) {
  const start = await startDocument(BASE);
  const headers = { Authorization: `Bearer ${start.token}`, 'Content-Type': 'application/json' };
  const columns = ['title', 'assignee', 'status', 'deadline', 'action'];
  const row = Object.fromEntries(columns.map(name => [name, `${name}-with-a-wide-value`]));
  const datasetResponse = await fetch(`${BASE}/api/artifacts`, { method: 'POST', headers, body: JSON.stringify({ dataset: [row] }) });
  const dataset = await datasetResponse.json();
  if (!datasetResponse.ok) throw new Error(`table width dataset: ${datasetResponse.status}`);
  const table = height => `<DataTable data="$wide" ${height ? 'height={420}' : ''}>${columns.map(name => name === 'action'
    ? '<Column col="action" title="Action"><Button>Last row action</Button></Column>'
    : `<Column col="${name}" title="${name}" />`).join('')}</DataTable>`;
  const markup = `<Helmet><title>Volta card table width</title><Import name="wide_data" src="ref:${dataset.id}" /><Query name="wide">{\`select * from wide_data.rows\`}</Query></Helmet>
    <div className="ds ds-volta p-4" data-design="tw">${['default', 'explicit'].map(mode => `<section id="${mode}" className="v-hard v-card"><div>${table(mode === 'explicit')}</div></section>`).join('')}</div>`;
  const published = await fetch(`${BASE}/api/artifacts/${start.id}`, { method: 'PUT', headers, body: JSON.stringify({ title: 'Volta card table width', theme: 'volta', markup }) });
  if (!published.ok) throw new Error(`table width publish: ${published.status} ${(await published.text()).slice(0, 300)}`);
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  try {
    await page.goto(`${BASE}/a/${start.id}`, { waitUntil: 'load' });
    const doc = await documentFrame(page);
    await doc.waitForSelector('#explicit [data-slot="data-table"] button', { timeout: 20000 });
    const measured = await doc.evaluate(() => ['default', 'explicit'].map(mode => {
      const card = document.getElementById(mode);
      const child = card.firstElementChild;
      const scroll = card.querySelector('[data-slot="data-table"] > div');
      const button = scroll.querySelector('button');
      const before = button.getBoundingClientRect();
      scroll.scrollLeft = scroll.scrollWidth;
      const after = button.getBoundingClientRect();
      const box = scroll.getBoundingClientRect();
      return { mode, viewport: document.documentElement.clientWidth, rootWidth: document.documentElement.scrollWidth,
        cardWidth: card.clientWidth, cardScrollWidth: card.scrollWidth, childWidth: child.getBoundingClientRect().width,
        clientWidth: scroll.clientWidth, scrollWidth: scroll.scrollWidth, scrollLeft: scroll.scrollLeft,
        beforeLeft: before.left, afterLeft: after.left, afterRight: after.right, boxLeft: box.left, boxRight: box.right };
    }));
    console.log(JSON.stringify({ voltaCardTables: measured }, null, 1));
    for (const m of measured) {
      check(m.rootWidth <= m.viewport + 1 && m.cardScrollWidth <= m.cardWidth + 1, `${m.mode}: card and document contain the wide table`);
      check(m.clientWidth > 0 && m.clientWidth < m.cardWidth && m.scrollWidth > m.clientWidth, `${m.mode}: horizontal overflow belongs to the bounded table`);
      check(m.scrollLeft > 0 && m.afterLeft >= m.boxLeft - 1 && m.afterRight <= m.boxRight + 1, `${m.mode}: scrolling reveals the last row action`);
    }
  } finally { await page.close(); }
}
