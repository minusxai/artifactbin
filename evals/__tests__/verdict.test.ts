/**
 * What makes a run PASS. The task's own `checks` decide; everything else the
 * scorer computed is recorded for the reader but never gates — a harness that
 * fell over AFTER the document was published (DeepSeek V4 Flash 400s on an
 * image the agent fetched to look at its own work) has still done the job, and
 * a run that is really a failure will fail a check that matters.
 */
import { describe, it, expect } from 'vitest';
import { checksToRecord, verdictFor } from '../lib/score/verdict';

describe('verdictFor', () => {
  it('passes when every gated check holds', () => {
    expect(verdictFor({ published: true, has_title: true, harness_ok: true }, ['published', 'has_title'])).toEqual({ passed: true, failed: [] });
  });

  it('fails naming only the gated checks that did not hold', () => {
    expect(verdictFor({ published: true, has_title: false, fits_390px: false }, ['published', 'has_title'])).toEqual({ passed: false, failed: ['has_title'] });
  });

  it('a non-gated check is never a failure, however it came out', () => {
    expect(verdictFor({ published: true, canonical_stable: false, harness_ok: false }, ['published'])).toEqual({ passed: true, failed: [] });
  });

  it('a gated check the scorer could not compute (null) is a failure — absence of evidence is not a pass', () => {
    expect(verdictFor({ published: null }, ['published'])).toEqual({ passed: false, failed: ['published'] });
  });
});

describe('checksToRecord', () => {
  /**
   * A check that does not APPLY to a task must not appear as a red FAIL beside
   * one that does. `used_mcp` on a REST task and `dataset_created` on a prose
   * task are both false, and both meaningless — in a four-column report they
   * read as four failures. Task-specific checks are recorded only where the task
   * gates them; the ones that describe any run are always recorded.
   */
  const all = {
    published: true, has_title: true, canonical_stable: false, used_start_document: false, harness_ok: true,
    no_console_errors: true, fits_390px: true, chart_marks_drawn: false, dataset_created: false,
    query_ran: false, used_edits_endpoint: false, used_mcp: false, kept_untouched_text: null,
  };

  it('always records the checks that describe ANY run, gated or not', () => {
    const rec = checksToRecord(all, ['published']);
    expect(Object.keys(rec)).toEqual(expect.arrayContaining(['published', 'has_title', 'canonical_stable', 'used_start_document', 'harness_ok']));
    expect(rec.canonical_stable).toBe(false); // informative, still shown
  });

  it('drops a task-specific check the task does not gate', () => {
    const rec = checksToRecord(all, ['published', 'has_title']);
    for (const k of ['used_mcp', 'dataset_created', 'query_ran', 'used_edits_endpoint', 'chart_marks_drawn']) {
      expect(rec).not.toHaveProperty(k);
    }
  });

  it('records a task-specific check WHEN the task gates it, however it came out', () => {
    const rec = checksToRecord(all, ['published', 'used_mcp', 'dataset_created']);
    expect(rec.used_mcp).toBe(false);
    expect(rec.dataset_created).toBe(false);
  });

  it('a gated check the scorer could not compute is recorded as false, not dropped', () => {
    expect(checksToRecord(all, ['kept_untouched_text']).kept_untouched_text).toBe(false);
  });

  it('never records a non-gated check the scorer could not compute', () => {
    expect(checksToRecord({ ...all, no_console_errors: null }, ['published'])).not.toHaveProperty('no_console_errors');
  });
});
