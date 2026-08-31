/**
 * `declaresQueries` — does a reader's interaction with this document need a
 * server round trip?
 *
 * The reader/owner split (proxy.ts) turns on `declaresLiveData`, of which this
 * is half, and for PRIVATE documents only: a private document that declares a query keeps its parent page, because the
 * served document's own transport is an anonymous GET of /a/<id>/query and a
 * private document answers that with the uniform 404 — the page, holding the
 * session, relays instead. Its edges are exactly where a wrong answer is
 * invisible:
 *  - `<Query>` written in PROSE is text, not a declaration — a document that
 *    merely talks about queries must still get its top-level paint;
 *  - a `<Value>` alone does NOT count: a bound control moves the value, and
 *    with no query depending on it nothing re-runs — no transport is needed
 *    (lib/story-runtime/store only calls the transport for dirty QUERIES);
 *  - source that does not parse declares nothing (the renderer shows it as
 *    escaped text), and must never throw here — this runs on every read.
 */
import { describe, expect, it } from 'vitest';
import { declaresQueries } from '@/lib/story/helmet';

const helmet = (inner: string) => `<Helmet>${inner}</Helmet><div><h1>Doc</h1></div>`;

describe('declaresQueries', () => {
  it('is true for a document with a <Query>', () => {
    expect(declaresQueries(helmet('<Query name="sales">{`select 1`}</Query>'))).toBe(true);
  });

  it('is FALSE for a document with only <Value>s — nothing re-runs, so nothing needs a transport', () => {
    expect(declaresQueries(helmet('<Value name="region" type="string" />'))).toBe(false);
    expect(declaresQueries(helmet('<Value name="rows" type="table" value={[{"a":1}]} />'))).toBe(false);
  });

  it('is false for plain prose, and for a Helmet of only title/style/meta', () => {
    expect(declaresQueries('<div><h1>Title</h1><p>Plain words.</p></div>')).toBe(false);
    expect(declaresQueries(helmet('<title>T</title><style>{`a{}`}</style><meta name="x" content="y" />'))).toBe(false);
  });

  it('does not count <Query> written in prose, outside Helmet', () => {
    expect(declaresQueries('<div><p>Use a &lt;Query name="x"&gt; to load data.</p></div>')).toBe(false);
    expect(declaresQueries('<div><code>{`<Query name="x">{\\`select 1\\`}</Query>`}</code></div>')).toBe(false);
  });

  it('never throws: unparseable, null and empty source declare nothing', () => {
    expect(declaresQueries('<div><Query name="x">{`select 1`}</Query>')).toBe(false);
    expect(declaresQueries(null)).toBe(false);
    expect(declaresQueries('')).toBe(false);
  });
});
