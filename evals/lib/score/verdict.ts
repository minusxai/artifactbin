/**
 * What makes a run PASS.
 *
 * ONLY the checks the task lists gate it. Everything else the scorer computed is
 * recorded for the reader and never fails a run — because a scorer that gates on
 * everything it can measure turns information into noise: `canonical_stable`
 * false means the product canonicalized the agent's markup (a `<Helmet>` hoisted
 * from mid-document), which is the product working; and a harness that fell over
 * AFTER publishing (DeepSeek V4 Flash 400s on an image the agent fetched to look
 * at its own work) still produced the document that was asked for. A run that is
 * really a failure fails a check that matters.
 */
/**
 * Checks that can only be answered from the recording proxy's ledger. Everything
 * here describes HOW the protocol was used; none of it describes whether the
 * document exists, which the product answers on its own.
 */
const LEDGER_ONLY = new Set([
  'published_first_try', 'read_docs_before_write', 'no_unknown_endpoints',
  'canonical_stable', 'dataset_created', 'used_edits_endpoint', 'used_mcp',
  'query_ran',
]);

/**
 * The checks that may DECIDE this run.
 *
 * `verdictFor` fails a gated check that is not true — absence of evidence is not
 * a pass, and that is right for something we watched. It is wrong for something
 * we could not watch at all: an agent that reaches a public deployment through
 * its provider's own server-side browsing tool makes real calls that never cross
 * this machine, and failing it for "did not read the docs" grades our instrument
 * rather than the agent. When the ledger saw NOTHING, the ledger-only checks stop
 * gating and the run is judged on what it produced. They are still recorded — as
 * null, which the report renders "—".
 */
/**
 * The same rule, for the same reason, one axis over: in `plugins`/`mcp` mode
 * the protocol is INSTALLED rather than read, so there is no docs fetch to
 * observe and `read_docs_before_write: false` would grade the mode instead of
 * the agent. Three of the comparison tasks list it, so it has to stop gating
 * rather than merely stop being recorded.
 */
const NEEDS_A_DOCS_FETCH = new Set(['read_docs_before_write']);

/**
 * And once more, for the harness that has no MCP client. Its `mcp` task now
 * RUNS — over REST, labelled — because a skipped cell reads as a failure and
 * shrinks the denominator its column is judged against. But `used_mcp` then
 * asks it to prove it did the thing it cannot do, and a red cell for an
 * impossible check is the same lie as a green one. The task's other checks —
 * did it publish, is there a title, did the document render — are exactly as
 * meaningful over REST, and those still decide it.
 */
const NEEDS_MCP = new Set(['used_mcp']);

/**
 * And once more, one axis further over: `no_local_checkout_reads` is read out of
 * the HARNESS TRANSCRIPT's tool calls, and some harnesses emit none — OpenCode
 * can exit before its final event, which is the whole reason
 * `HarnessResult.docsReadCalls` is nullable. A run like that answers null, and a
 * gated null is a failure, so a column that published everything asked of it
 * would go red for "we could not see which tools it used" — our instrument
 * again, not the agent.
 *
 * The check is worth gating where it CAN be answered: production run 33702277600
 * has an agent finding this checkout, reading the skill tree it was meant to
 * fetch over the wire, and then reading the grading rubric of the very task it
 * was being graded on. A transcript that shows nothing is not evidence that this
 * did not happen — it is no evidence at all, and the run is judged on what it
 * produced instead. The check is still RECORDED, as null, which the report
 * renders "—".
 */
const NEEDS_TOOL_TELEMETRY = new Set(['no_local_checkout_reads']);

export interface GateOptions {
  trafficObserved: boolean;
  vocabularyInstalled?: boolean;
  /** The task asked for MCP and this harness has no client, so it ran over REST. */
  transportSubstituted?: boolean;
  /**
   * Did the harness emit tool telemetry at all? Absent means YES: a gate must
   * never be dropped by a caller's silence, only by a caller that measured the
   * absence and says so (`result.docsReadCalls !== null`).
   */
  toolTelemetryObserved?: boolean;
}

export function gatedChecks(gated: string[], opts: GateOptions): string[] {
  let out = opts.trafficObserved ? gated : gated.filter((c) => !LEDGER_ONLY.has(c));
  if (opts.vocabularyInstalled) out = out.filter((c) => !NEEDS_A_DOCS_FETCH.has(c));
  if (opts.transportSubstituted) out = out.filter((c) => !NEEDS_MCP.has(c));
  if (opts.toolTelemetryObserved === false) out = out.filter((c) => !NEEDS_TOOL_TELEMETRY.has(c));
  return out;
}

export interface Verdict {
  passed: boolean;
  failed: string[];
}

/**
 * Checks that describe ANY run and are therefore always worth recording,
 * whether or not a task grades them.
 */
const ALWAYS_REPORT = new Set([
  // Whether the DRIVER's own preparation worked describes any run, and it is the
  // one failure the ledger cannot see: the driver's calls are marked and skipped,
  // so a broken seed would otherwise read as an agent that did nothing.
  'setup_ok', 'checks_ok',
  'published', 'published_first_try', 'read_docs_before_write', 'no_unknown_endpoints',
  'canonical_stable', 'has_title', 'used_start_document', 'harness_ok',
  'no_console_errors', 'no_failed_responses', 'fits_390px',
  // Whether the agent read this checkout describes any run at all — and a column
  // where it is false is a column that measured the disk instead of the wire.
  'no_local_checkout_reads',
]);

/**
 * Which checks become rows.
 *
 * Everything in `ALWAYS_REPORT` that the scorer could compute, plus every check
 * the task gates. A task-SPECIFIC check the task does not gate is dropped
 * entirely rather than recorded as false: `used_mcp` on a REST task and
 * `dataset_created` on a prose task are both false and both meaningless, and in
 * a four-column report a row of red FAILs reads as four failures instead of as
 * "not applicable" (the report renders an absent value as "—").
 */
export function checksToRecord(
  checks: Record<string, boolean | null | undefined>,
  gated: string[],
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [name, value] of Object.entries(checks)) {
    const isGated = gated.includes(name);
    if (!isGated && (!ALWAYS_REPORT.has(name) || value === null || value === undefined)) continue;
    out[name] = value === true;
  }
  return out;
}

export function verdictFor(checks: Record<string, boolean | null | undefined>, gated: string[]): Verdict {
  // A gated check the scorer could not compute is a failure: absence of evidence is not a pass.
  const failed = gated.filter((c) => checks[c] !== true);
  return { passed: failed.length === 0, failed };
}
