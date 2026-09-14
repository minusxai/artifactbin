/**
 * WHAT THE LEDGER MEASURES — the metrics read off the recorded HTTP of one run, and the artifact id
 * a run is finally scored against.
 *
 * The first of these is the thing the driver could not see while it measured from the first HTTP
 * call: how long its human waited before a URL existed. The second is the guardrail that stops a
 * fast empty stub from beating a real skeleton.
 *
 * Filed as `m1-instrumentation` — a milestone, not a seam — it also carried a credential-source
 * block (now beside the rest of the credential seam) and a prompt-text block that restated
 * `tasks.test.ts`. `ledger.test.ts` holds the ledger's own reading; this holds what is derived
 * from it.
 */
import { describe, it, expect } from 'vitest';
import { ledgerMetrics, scoredArtifactId } from '../lib/ledger';
import type { LedgerEntry } from '../lib/contracts';

const entry = (over: Partial<LedgerEntry>): LedgerEntry => ({
  t: 1_000, ms: 5, method: 'GET', path: '/docs', status: 200, ua: null, auth: null, error: null, ...over,
});

describe('msToFirstPublish — how long the human waited for a link', () => {
  const ledger = [
    entry({ t: 10_000, method: 'GET', path: '/docs/artifactbin/SKILL.md' }),
    entry({ t: 12_000, method: 'POST', path: '/api/artifacts', status: 400 }),
    entry({ t: 15_000, method: 'POST', path: '/api/artifacts', status: 201, artifactId: 'ab3cd9' }),
  ];

  it('measures from the spawn anchor, so agent boot is inside the number', () => {
    expect(ledgerMetrics(ledger, { startedAtMs: 4_000 }).msToFirstPublish).toBe(11_000);
  });

  it('falls back to the first entry when no anchor is given — a floor, not the truth', () => {
    expect(ledgerMetrics(ledger).msToFirstPublish).toBe(5_000);
  });

  it('is null when nothing ever published', () => {
    expect(ledgerMetrics([entry({ method: 'POST', path: '/api/artifacts', status: 400 })]).msToFirstPublish).toBeNull();
  });
});

describe('skeletonSections — was the early publish a document or a placeholder', () => {
  it('counts the headings of the FIRST successful write', () => {
    const m = ledgerMetrics([
      entry({ t: 1_000, method: 'POST', path: '/api/artifacts', status: 201,
        reqMarkup: '<div><h1>Support load</h1><h2>Volume</h2><h2>Resolution</h2><h3>By team</h3></div>' }),
      entry({ t: 2_000, method: 'PUT', path: '/api/artifacts/ab3cd9', status: 200, reqMarkup: '<div><h1>x</h1></div>' }),
    ]);
    expect(m.skeletonSections).toBe(4);
  });

  it('is null when that write carried no markup', () => {
    const m = ledgerMetrics([entry({ method: 'POST', path: '/api/artifacts', status: 201, reqFormat: 'dataset' })]);
    expect(m.skeletonSections).toBeNull();
  });
});

/**
 * WHERE A CREDENTIAL CAN COME FROM AT ALL. The product is CLI-only, so every retired way of handing a
 * token to an agent — the paste, a pre-provisioned secret, withholding one on purpose — is gone, and
 * the two that remain are the same account login read from two different mailboxes.
 */

describe('the edges the seed did not pin', () => {
  it('msToFirstPublish counts a conditional body write', () => {
    const m = ledgerMetrics([
      entry({ t: 3_000, method: 'PUT', path: '/api/artifacts/ab3cd9', status: 200, artifactId: 'ab3cd9' }),
    ], { startedAtMs: 1_000 });
    expect(m.msToFirstPublish).toBe(2_000);
  });

  it('msToFirstPublish is null when the ledger saw nothing at all', () => {
    expect(ledgerMetrics([]).msToFirstPublish).toBeNull();
  });

  it('skeletonSections reaches PAST a dataset-first write to the document that was actually published', () => {
    // data / dashboard / deck / scrolly all upload their rows before they write their document. Reading
    // the first 2xx write full stop would leave the guardrail null on four of seven tasks — catching
    // nothing, which is the opposite of a guardrail. It reads the first 2xx write that CARRIED MARKUP.
    const m = ledgerMetrics([
      entry({ t: 1_000, method: 'POST', path: '/api/artifacts', status: 201, reqFormat: 'dataset', artifactId: 'ds1111' }),
      entry({ t: 2_000, method: 'POST', path: '/api/artifacts', status: 201, reqMarkup: '<h1>a</h1><h2>b</h2><h3>c</h3>', artifactId: 'ab3cd9' }),
      entry({ t: 3_000, method: 'PUT', path: '/api/artifacts/ab3cd9', status: 200, reqMarkup: '<h1>a</h1>', artifactId: 'ab3cd9' }),
    ]);
    expect(m.skeletonSections).toBe(3);
    // …and the CLOCK does not move with it. The dataset upload is a real publish — it is when the human
    // first had a URL — so `msToFirstPublish` still answers from the first 2xx write of any kind.
    expect(ledgerMetrics([
      entry({ t: 1_000, method: 'POST', path: '/api/artifacts', status: 201, reqFormat: 'dataset', artifactId: 'ds1111' }),
      entry({ t: 2_000, method: 'POST', path: '/api/artifacts', status: 201, reqMarkup: '<h1>a</h1>', artifactId: 'ab3cd9' }),
      // Anchor 0 so the two candidates are plainly 1_000 (the rows) and 2_000 (the document) and the
      // assertion cannot be read as a coincidence with the anchor.
    ], { startedAtMs: 0 }).msToFirstPublish).toBe(1_000);
  });

  it('skeletonSections skips the FAILED first attempt and counts the first write that worked', () => {
    const m = ledgerMetrics([
      entry({ t: 1_000, method: 'POST', path: '/api/artifacts', status: 400, reqMarkup: '<h1>a</h1><h2>b</h2><h3>c</h3>' }),
      entry({ t: 2_000, method: 'POST', path: '/api/artifacts', status: 201, reqMarkup: '<h1>a</h1>' }),
    ]);
    expect(m.skeletonSections).toBe(1);
  });

  it('skeletonSections counts opening h1–h3 only: attributes yes, </h1> and <h4> and <header> no', () => {
    const markup = '<header><h1 class="t" id="x">T</h1></header><h2\n  data-a="1">A</h2><h3>B</h3><h4>C</h4><hgroup></hgroup>';
    const m = ledgerMetrics([entry({ method: 'POST', path: '/api/artifacts', status: 201, reqMarkup: markup })]);
    expect(m.skeletonSections).toBe(3);
  });

  it('skeletonSections is 0, not null, for a real but heading-less document', () => {
    const m = ledgerMetrics([entry({ method: 'POST', path: '/api/artifacts', status: 201, reqMarkup: '<p>just a paragraph</p>' })]);
    expect(m.skeletonSections).toBe(0);
  });

  it('leaves every neighbouring metric exactly as it was', () => {
    const m = ledgerMetrics([
      entry({ t: 1_000, method: 'GET', path: '/docs/artifactbin/SKILL.md', bytes: 10 }),
      entry({ t: 2_000, method: 'POST', path: '/api/artifacts', status: 201, reqMarkup: '<h1>a</h1>', markupUnchanged: true, artifactId: 'ab3cd9' }),
    ], { startedAtMs: 500 });
    expect(m.readDocsBeforeWrite).toBe(true);
    expect(m.publishedFirstTry).toBe(true);
    expect(m.canonicalStable).toBe(true);
    expect(m.docsFetches).toBe(1);
    expect(m.docsBytes).toBe(10);
    expect(m.httpCalls).toBe(2);
  });
});


describe('scoring a run whose agent named nothing', () => {
  it('falls through to null when there is no answer, no ledger write and no document to fall back on', () => {
    // Null means "there is no artifact to score" — the honest answer for a run that published nothing.
    expect(scoredArtifactId({ finalMessage: null, ledger: [], startId: null })).toBeNull();
  });

  it('still scores what the agent made, or what the ledger watched it write', () => {
    const written = [entry({ method: 'POST', path: '/api/artifacts', status: 201, artifactId: 'ledger1' })];
    expect(scoredArtifactId({ finalMessage: 'Done: https://x.test/a/stated1', ledger: [], startId: null })).toBe('stated1');
    expect(scoredArtifactId({ finalMessage: 'Done.', ledger: written, startId: null })).toBe('ledger1');
  });
});

/**
 * PROGRESSION — the two things we want to instrument before we ask agents for them: did a real
 * document arrive EARLY, and did the rest of the run EXTEND it rather than replace it wholesale.
 * Both are recorded and gate nothing; both are ledger-only, so an unobserved run answers null.
 */
describe('firstVersionEarly — a real document inside the first 40% of the wall clock', () => {
  const markupWrite = (t: number, over: Partial<LedgerEntry> = {}) =>
    entry({ t, method: 'POST', path: '/api/artifacts', status: 201, artifactId: 'ab3cd9', reqMarkup: '<h1>Report</h1>', ...over });

  it('is true when the first successful MARKUP write lands before 40% of the run had elapsed', () => {
    const m = ledgerMetrics([markupWrite(39_000)], { startedAtMs: 0, durationMs: 100_000 });
    expect(m.firstVersionEarly).toBe(true);
    expect(m.msToFirstMarkupWrite).toBe(39_000);
  });

  it('is false at and past the 40% mark — the boundary is not early', () => {
    expect(ledgerMetrics([markupWrite(40_000)], { startedAtMs: 0, durationMs: 100_000 }).firstVersionEarly).toBe(false);
    expect(ledgerMetrics([markupWrite(80_000)], { startedAtMs: 0, durationMs: 100_000 }).firstVersionEarly).toBe(false);
  });

  it('reads the first MARKUP write, not the dataset upload that beat it to the wire', () => {
    // A data/dashboard/deck/scrolly run publishes its rows first. That upload is a URL
    // (`msToFirstPublish` counts it) but it is not the document a reader can look at.
    const ledger = [
      entry({ t: 5_000, method: 'POST', path: '/api/artifacts', status: 201, reqFormat: 'dataset', artifactId: 'ds1111' }),
      markupWrite(60_000),
    ];
    const m = ledgerMetrics(ledger, { startedAtMs: 0, durationMs: 100_000 });
    expect(m.msToFirstPublish).toBe(5_000);
    expect(m.msToFirstMarkupWrite).toBe(60_000);
    expect(m.firstVersionEarly).toBe(false);
  });

  it('is false when the agent published no markup at all, and null when the ledger saw nothing', () => {
    expect(ledgerMetrics([entry({ method: 'POST', path: '/api/artifacts', status: 400 })], { startedAtMs: 0, durationMs: 100_000 }).firstVersionEarly).toBe(false);
    expect(ledgerMetrics([], { startedAtMs: 0, durationMs: 100_000 }).firstVersionEarly).toBeNull();
  });

  it('is null when the caller gave no wall clock to measure against — 40% of nothing is not an answer', () => {
    expect(ledgerMetrics([markupWrite(1_000)], { startedAtMs: 0 }).firstVersionEarly).toBeNull();
    expect(ledgerMetrics([markupWrite(1_000)], { startedAtMs: 0, durationMs: 0 }).firstVersionEarly).toBeNull();
  });

  it('msToFirstMarkupWrite shares the spawn anchor with msToFirstPublish, so agent boot is inside it', () => {
    expect(ledgerMetrics([markupWrite(10_000)], { startedAtMs: 4_000 }).msToFirstMarkupWrite).toBe(6_000);
    expect(ledgerMetrics([entry({ method: 'POST', path: '/api/artifacts', status: 201, reqFormat: 'dataset' })]).msToFirstMarkupWrite).toBeNull();
  });

  it('measures the first write to THE SCORED DOCUMENT when the driver names one', () => {
    // The scratch document at 10s is not the deliverable; the clock runs to the real one at 70s,
    // which is past 40% of a 100s run.
    const ledger = [
      entry({ t: 10_000, method: 'POST', path: '/api/artifacts', status: 201, artifactId: 'zz9999', reqMarkup: '<h1>scratch</h1>' }),
      entry({ t: 70_000, method: 'POST', path: '/api/artifacts', status: 201, artifactId: 'ab3cd9', reqMarkup: '<h1>Report</h1><h2>Detail</h2>' }),
    ];
    const m = ledgerMetrics(ledger, { startedAtMs: 0, durationMs: 100_000, documentId: 'ab3cd9' });
    expect(m.msToFirstMarkupWrite).toBe(70_000);
    expect(m.firstVersionEarly).toBe(false);
    expect(m.skeletonSections).toBe(2);
    // Unscoped, the scratch write is the first markup write and the run looks early.
    expect(ledgerMetrics(ledger, { startedAtMs: 0, durationMs: 100_000 }).firstVersionEarly).toBe(true);
  });

  it('an /edits version with no recorded markup is still a version, and leaves skeletonSections null', () => {
    const m = ledgerMetrics([
      entry({ t: 1_000, method: 'POST', path: '/api/artifacts/ab3cd9/edits', status: 200, artifactId: 'ab3cd9' }),
    ], { startedAtMs: 0, durationMs: 100_000, documentId: 'ab3cd9' });
    expect(m.agentVersions).toBe(1);
    expect(m.msToFirstMarkupWrite).toBe(1_000);
    expect(m.skeletonSections).toBeNull();
  });
});

describe('progressiveEdits — two versions of the agent\'s own, the later ones extending the first', () => {
  const create = entry({ t: 1_000, method: 'POST', path: '/api/artifacts', status: 201, artifactId: 'ab3cd9', reqMarkup: '<h1>Report</h1>' });

  it('is true when the writes after the first keep the same document', () => {
    expect(ledgerMetrics([
      create,
      entry({ t: 2_000, method: 'POST', path: '/api/artifacts/ab3cd9/edits', status: 200, artifactId: 'ab3cd9' }),
      entry({ t: 3_000, method: 'PUT', path: '/api/artifacts/ab3cd9', status: 200, artifactId: 'ab3cd9' }),
    ]).progressiveEdits).toBe(true);
  });

  it('is false when the agent forked instead — a second create is a new artifact, not a version', () => {
    expect(ledgerMetrics([
      create,
      entry({ t: 2_000, method: 'POST', path: '/api/artifacts', status: 201, artifactId: 'zz9999', reqMarkup: '<h1>Report</h1><p>more</p>' }),
    ]).progressiveEdits).toBe(false);
    expect(ledgerMetrics([
      create,
      entry({ t: 2_000, method: 'PUT', path: '/api/artifacts/zz9999', status: 200, artifactId: 'zz9999' }),
    ]).progressiveEdits).toBe(false);
  });

  it('is false for the single big publish at the end — one version is not a progression', () => {
    expect(ledgerMetrics([create]).progressiveEdits).toBe(false);
  });

  it('counts only writes the product ANSWERED — a 4xx stored nothing', () => {
    expect(ledgerMetrics([
      create,
      entry({ t: 2_000, method: 'POST', path: '/api/artifacts/ab3cd9/edits', status: 409, artifactId: 'ab3cd9' }),
    ]).progressiveEdits).toBe(false);
  });

  it('is null when the ledger observed nothing at all', () => {
    expect(ledgerMetrics([]).progressiveEdits).toBeNull();
  });

  /**
   * An OLD ledger whose create carries no `artifactId` (the field postdates those runs) leaves the
   * first write's document unidentifiable, and an unidentifiable first document cannot be shown to
   * be the one the later writes extended. False, deliberately — the alternative is crediting a
   * progression we cannot see. Newer ledgers always carry the id, so this is history only.
   */
  it('is false when the first write does not say which artifact it made', () => {
    expect(ledgerMetrics([
      entry({ t: 1_000, method: 'POST', path: '/api/artifacts', status: 201, reqMarkup: '<h1>Report</h1>' }),
      entry({ t: 2_000, method: 'POST', path: '/api/artifacts/ab3cd9/edits', status: 200, artifactId: 'ab3cd9' }),
    ]).progressiveEdits).toBe(false);
  });

  /**
   * A DATASET UPLOAD IS NOT A VERSION OF THE DOCUMENT. `data`, `dashboard`, `deck` and `scrolly`
   * push their rows first, so counting content writes made a document that was published early
   * and then extended read as no progression at all. Told which artifact the run is scored on,
   * the count is a count of THAT document and the rows upload falls out of it.
   */
  const DATASET_FIRST = [
    entry({ t: 1_000, method: 'POST', path: '/api/artifacts', status: 201, reqFormat: 'dataset', artifactId: 'ds1111' }),
    entry({ t: 2_000, method: 'POST', path: '/api/artifacts', status: 201, artifactId: 'ab3cd9', reqMarkup: '<h1>Report</h1>' }),
    entry({ t: 3_000, method: 'POST', path: '/api/artifacts/ab3cd9/edits', status: 200, artifactId: 'ab3cd9' }),
  ];

  it('counts versions of the SCORED DOCUMENT on a dataset-first run, not the rows upload', () => {
    const m = ledgerMetrics(DATASET_FIRST, { documentId: 'ab3cd9' });
    expect(m.progressiveEdits).toBe(true);
    expect(m.agentVersions).toBe(2);
  });

  it('does not count a write to any OTHER artifact as a version of the document', () => {
    // A scratch document the agent made to look at its own rendering is not the deliverable.
    const m = ledgerMetrics([
      entry({ t: 1_000, method: 'POST', path: '/api/artifacts', status: 201, artifactId: 'ab3cd9', reqMarkup: '<h1>Report</h1>' }),
      entry({ t: 2_000, method: 'POST', path: '/api/artifacts', status: 201, artifactId: 'zz9999', reqMarkup: '<h1>scratch</h1>' }),
      entry({ t: 3_000, method: 'PUT', path: '/api/artifacts/zz9999', status: 200, artifactId: 'zz9999' }),
    ], { documentId: 'ab3cd9' });
    expect(m.progressiveEdits).toBe(false);
    expect(m.agentVersions).toBe(1);
  });

  it('is null for an unobserved ledger and 0 versions even when a document id was named', () => {
    expect(ledgerMetrics([], { documentId: 'ab3cd9' }).progressiveEdits).toBeNull();
    expect(ledgerMetrics([], { documentId: 'ab3cd9' }).agentVersions).toBe(0);
  });

  /**
   * The unscoped reading is the LEGACY one, reached only where there is no scored document. It
   * cannot tell a rows upload from a document, so the same dataset-first run reads false — which
   * is exactly why the driver always passes the id.
   */
  it('falls back to the unscoped reading when no document id was given', () => {
    expect(ledgerMetrics(DATASET_FIRST).progressiveEdits).toBe(false);
    expect(ledgerMetrics(DATASET_FIRST).agentVersions).toBe(3);
  });
});
