/**
 * An embed that cannot resolve must be rejected at publish.
 *
 * Found by driving ChatGPT through the real connector: it wrote
 * `<Question source="ref:<id>" question="…" />` — plausible prop names, and
 * wrong, since the adapter reads `data` and `viz`. We accepted it and the page
 * rendered "data unavailable — the referenced dataset did not resolve". The
 * `ref:` was valid; nothing was reading it.
 *
 * That is the worst shape of failure: a successful publish that cannot render,
 * discovered by looking at the page.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { findBrokenEmbeds } from '@/lib/story/refs';
import { POST as createArtifact } from '@/app/api/artifacts/route';

import { mintToken } from '@/lib/tokens';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();


let token: string;
let datasetId: string;

beforeEach(async () => {
  token = (await mintToken('embed-test')).token;
  const res = await create({ title: 'data', dataset: 'month,revenue\n2026-01,120' });
  datasetId = res.body.id;
});

async function create(body: Record<string, unknown>) {
  const res = await createArtifact(new Request('http://localhost:3000/api/artifacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
}

const wrap = (inner: string) => `<div data-design="tw" className="@container p-6">${inner}</div>`;
/** The document declares its table: a <Query> over the dataset, bound as `$rows`. */
const declared = (inner: string) => `<Helmet><Query name="rows">{\`select * from ref_${datasetId}\`}</Query></Helmet>` + wrap(inner);

describe('a Question that cannot resolve is refused', () => {
  it('rejects the exact shape ChatGPT published', async () => {
    const { status, body } = await create({
      title: 'broken',
      markup: wrap(`<Question source="ref:${datasetId}" question="Chart revenue by month" />`),
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_jsx');
    const message = body.details[0].message as string;
    expect(message).toMatch(/no "data" prop/);
    expect(message).toMatch(/source/);   // names what they actually used
    expect(message).toMatch(/vega-lite/); // and what to write instead
  });

  it('rejects a Question with no props at all', async () => {
    const { status } = await create({ title: 'bare', markup: wrap('<Question title="x" />') });
    expect(status).toBe(400);
  });

  it('applies to Number too', async () => {
    expect((await create({ title: 'n', markup: wrap('<Number col="revenue" agg="sum" />') })).status).toBe(400);
  });

  it('rejects the RETIRED direct binding data="ref:<id>", pointing at a <Query>', async () => {
    const { status, body } = await create({ title: 'ref', markup: wrap(`<Question data="ref:${datasetId}" />`) });
    expect(status).toBe(400);
    const message = body.details[0].message as string;
    expect(message).toMatch(/does not name a declared table/);
    expect(message).toContain(`ref_${datasetId}`);
    expect(message).toMatch(/<Query name="rows">/);
  });

  it('names the single_value shape when singleValueConfig is written without kind: "single_value"', async () => {
    // What Codex actually wrote for a KPI tile: the config at the top level of
    // <Question>. It publishes as a two-row TABLE — a tile that looks like a bug.
    const { status, body } = await create({
      title: 'kpi',
      markup: declared('<Question data="$rows" singleValueConfig={{"label":"Revenue","prefix":"$"}} />'),
    });
    expect(status).toBe(400);
    const message = body.details[0].message as string;
    expect(message).toMatch(/single_value/);
    expect(message).toMatch(/viz=\{\{"kind":"single_value"/);
    // …and the same for a viz that carries the config but not the kind.
    const r2 = await create({ title: 'kpi2', markup: declared('<Question data="$rows" viz={{"singleValueConfig":{"label":"Revenue"}}} />') });
    expect(r2.status).toBe(400);
    expect((r2.body.details[0].message as string)).toMatch(/single_value/);
    // The right shape publishes.
    const ok = await create({ title: 'kpi3', markup: declared('<Question data="$rows" viz={{"kind":"single_value","yCols":["revenue"],"singleValueConfig":{"label":"Revenue","prefix":"$","format":",.0f"}}} />') });
    expect(ok.status).toBe(201);
  });

  it('rejects inline rows in data=', async () => {
    const { status, body } = await create({ title: 'inline', markup: wrap('<Question data={[{"a":1}]} />') });
    expect(status).toBe(400);
    expect((body.details[0].message as string)).toMatch(/does not name a declared table/);
  });
});

describe('a correct embed still publishes', () => {
  it('accepts data + viz', async () => {
    const { status } = await create({
      title: 'good',
      markup: declared(`<Question title="Revenue" data="$rows" viz={{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"month","type":"nominal"},"y":{"field":"revenue","type":"quantitative"}}}}} height="430px" />`),
    });
    expect(status).toBe(201);
  });

  it('accepts a Question with data and no viz (the table default)', async () => {
    const { status } = await create({ title: 'table', markup: declared(`<Question title="Rows" data="$rows" />`) });
    expect(status).toBe(201);
  });

  it('rejects a format spec d3 cannot parse — it would throw inside SSR and 500 every render of the document', async () => {
    // The exact attribute Pi published on production (agent eval, 2026-08-28): the page, raw and export were all 500s.
    const { status, body } = await create({ title: 'fmt', markup: declared(`<p>We drank <Number data="$rows" col="revenue" agg="sum" format=",0" /> cups</p>`) });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_jsx');
    const message = body.details[0].message as string;
    expect(message).toMatch(/",0"/);       // names what they wrote
    expect(message).toMatch(/,\.0f/);      // and what to write instead
    expect(body.details[0].tag).toBe('Number');
    expect(body.details[0].attr).toBe('format');
  });

  it('rejects a DataTable column fmt d3 cannot parse, the same way', async () => {
    const { status, body } = await create({ title: 'fmt', markup: declared(`<DataTable data="$rows" columns={[{"col":"revenue","fmt":"0,0"}]} />`) });
    expect(status).toBe(400);
    expect((body.details[0].message as string)).toMatch(/"0,0"/);
  });

  it('accepts a valid format spec', async () => {
    expect((await create({ title: 'fmt', markup: declared(`<p><Number data="$rows" col="revenue" agg="sum" format=",.0f" /></p>`) })).status).toBe(201);
  });

  it('leaves markup with no embeds alone', async () => {
    expect((await create({ title: 'plain', markup: wrap('<h1 className="text-3xl">Hi</h1>') })).status).toBe(201);
  });
});

describe('<Param> is retired', () => {
  it('names the replacement: a Helmet <Value> bound to a native control', async () => {
    const { status, body } = await create({ title: 'param', markup: wrap('<Param name="region" type="text" options={["EU","NA"]} />') });
    expect(status).toBe(400);
    const message = body.details[0].message as string;
    expect(message).toMatch(/retired/);
    expect(message).toMatch(/<Value name=/);
    expect(message).toMatch(/<select value="\$region"/);
  });
});

/**
 * A syntax error must be CORRECTABLE without a re-send.
 *
 * Measured on the eval matrix: opencode failed publish seven times in one
 * dashboard run, pi twice, each retry replaying a context that by then held
 * ~65 KB of docs. All the door said was `JSX syntax error: Unexpected token
 * (1:92)` — a line and column into a document the agent was holding in a shell
 * heredoc, with no span and no offending text. Every other refusal in this
 * codebase names its fix; this one, which fires on the biggest documents, did
 * not.
 */
describe('a JSX syntax error points at the character', () => {
  // A real PARSE failure: the viz object never closes. (An unbalanced brace is
  // the commonest way a big data document breaks — the eval runs are full of it.)
  const bad = '<div className="p-8">\n  <p>fine</p>\n  <Question data="$q" viz={{"kind":"bar"} />\n</div>';

  it('carries a span and the offending source, in the caller\'s own coordinates', async () => {
    const { status, body } = await create({ markup: bad });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_jsx');
    const [d] = body.details;
    expect(d.start).toEqual(expect.any(Number));
    // The span names a real position in what was SENT…
    expect(d.start).toBeLessThan(bad.length);
    // …and the message quotes the text there, so a fix needs no second guess.
    expect(d.snippet).toEqual(expect.any(String));
    expect(bad).toContain(d.snippet.replace(/^…|…$/g, '').split('▶')[0].trim().slice(0, 12));
    expect(d.message).toMatch(/line \d+/);
  });
});

/**
 * MEASURED, on the CI smoke run and then reproduced: OpenCode published
 *
 *   <Question data="$totals" viz={{"mark":"line","encoding":{…}}} />
 *
 * — the vega-lite spec where the ENVELOPE belongs. It publishes 200 and draws
 * nothing, because `vizPropToEnvelope` reads `prop.spec`, finds none, and
 * renders a blank chart. The task failed `chart_marks_drawn` on a document the
 * door had just told the agent was fine.
 *
 * That is the failure this whole check exists to prevent — "an embed with no
 * data prop publishes fine and renders empty, so reject it" — one level in.
 * A top-level `mark` or `encoding` with no `spec` cannot be a valid envelope,
 * so it is unambiguous and safe to refuse.
 */
describe('a viz that is a bare spec instead of an envelope', () => {
  const q = (viz: string) =>
    `<Helmet><Query name="q">{\`select a from ref_abc123\`}</Query></Helmet>\n<Question data="$q" viz={${viz}} />`;

  it('is refused, and the message shows the wrapper', () => {
    const errs = findBrokenEmbeds(q('{"mark":"line","encoding":{"x":{"field":"a","type":"ordinal"}}}'));
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].message).toMatch(/"kind"\s*:\s*"vega-lite"/);
    expect(errs[0].message).toMatch(/"spec"/);
  });

  it('accepts the correct envelope', () => {
    expect(findBrokenEmbeds(q('{"kind":"vega-lite","spec":{"mark":"line","encoding":{"x":{"field":"a","type":"ordinal"}}}}'))).toEqual([]);
  });

  /** A `<Question>` with no viz at all is the themed TABLE, and stays legal. */
  it('leaves a viz-less Question alone', () => {
    expect(findBrokenEmbeds('<Helmet><Query name="q">{`select a from ref_abc123`}</Query></Helmet>\n<Question data="$q" />')).toEqual([]);
  });
});
