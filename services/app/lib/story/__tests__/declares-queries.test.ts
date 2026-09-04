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
import { declaresBoundSources, declaresLiveData, declaresQueries } from '@/lib/story/helmet';

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

/**
 * `declaresBoundSources` — the THIRD reader interaction that reaches the
 * server, and the one that is not in `<Helmet>` at all.
 *
 * A bound `<img src="$pick">` imports the URL a reader picked through
 * `/a/<id>/assets`, and the frame cannot load that itself: it is opaque-origin,
 * so its `<img>` carries no cookie and a private document answers the uniform
 * 404 — for its own owner as much as for a stranger. So a private document with
 * one keeps its parent page, exactly as one declaring a query does.
 *
 * Same edges as its siblings: parsed and never pattern-matched, so `$pick` in
 * prose is prose; a literal URL is not a binding (publish already imported it);
 * and source that does not parse declares nothing and never throws.
 */
describe('declaresBoundSources', () => {
  const yes = (s: string) => expect(declaresBoundSources(s)).toBe(true);
  const no = (s: string) => expect(declaresBoundSources(s)).toBe(false);

  it('counts a whole-attribute binding and the braced form alike', () => {
    yes('<Helmet><Value name="pick" type="string" /></Helmet><div><img src="$pick" /></div>');
    yes('<Helmet><Value name="k" type="string" /></Helmet><div><img src="https://cdn.x.com/{$k}.png" /></div>');
    yes('<div><section><img alt="deep" src="$pick" /></section></div>');
  });

  it('does not count a literal URL, a ref:, or a `$` anywhere else', () => {
    no('<div><img src="https://cdn.x.com/fixed.png" /></div>');
    no('<div><img src="ref:abc123" /></div>');
    no('<div><p>pick with $pick in the prose</p></div>');
    no('<div><Number data="$q" format="$,.0f" /></div>');
    no('<div><input value="$pick" /></div>');
    no('<div><Video poster="$pick" src="https://youtu.be/x" /></div>');
  });

  it('is false for nothing and for source that does not parse', () => {
    no('');
    expect(declaresBoundSources(null)).toBe(false);
    no('<div><p>unclosed');
  });
});

describe('declaresLiveData counts a bound source too', () => {
  it('is true for a document whose only server interaction is a bound image', () => {
    expect(declaresLiveData('<Helmet><Value name="pick" type="string" /></Helmet><div><img src="$pick" /></div>')).toBe(true);
  });

  it('is still false for a document whose values move nothing off the page', () => {
    expect(declaresLiveData('<Helmet><Value name="r" type="string" /></Helmet><div><input value="$r" /><img src="https://cdn.x.com/a.png" /></div>')).toBe(false);
  });
});
