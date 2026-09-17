/**
 * THE SHELL-ESCAPED BACKTICK — the one syntax fault worth REPAIRING rather
 * than refusing.
 *
 * An agent holds the document in a shell heredoc or builds the JSON body in a
 * string, and escapes the backticks that open a `<Query>`'s template literal
 * the way a double-quoted shell string requires. The backslashes reach us:
 *
 *     <Query name="q">{\`select …\`}</Query>
 *
 * MEASURED, on the CI agent eval (run 33868923276, the `data` task): that
 * publish was refused as `invalid_jsx` with "Expecting Unicode escape sequence
 * \uXXXX (1:311)", and the agent spent 171s composing it and a further 90s
 * working out what to change — 39% of a 673s task, on two backslashes. The
 * server's own share of that task was 226ms.
 *
 * Why REPAIR and not just name it, when `</script` in script text is refused:
 * a backslash-escaped backtick where an expression must start cannot occur in
 * ANY valid document, so there is nothing to preserve and no meaning to
 * change. And the repair is PROVED rather than guessed — it is applied only at
 * the position the parser rejected, and kept only if the result then parses.
 * That is the `<p><div>` rule ("the authors are agents, this is something an
 * LLM emits constantly") with an accept gate on top.
 *
 * The two escapes must go TOGETHER, which is why this is not a
 * one-character-at-a-time loop: remove only the opening one and the template
 * literal opens, the closing `\`` becomes a VALID escape inside it, and the
 * literal then runs to the end of the document.
 */
import { describe, expect, it } from 'vitest';
import { parseJsx } from '../index';
import { repairJsxSource } from '../repair';
import { syntaxErrorDetail } from '../syntax-error';

const escaped = '<article><Helmet><Query name="q">{\\`select 1\\`}</Query></Helmet><p>hi</p></article>';

describe('repairJsxSource', () => {
  it('repairs the escaped backticks and the result parses', () => {
    const out = repairJsxSource(escaped);
    expect(out, 'the shell-escape signature was not recognised').not.toBeNull();
    expect(parseJsx(out!.source).ok).toBe(true);
    expect(out!.source).toContain('{`select 1`}');
    expect(out!.repair.removed).toBe(2);
    expect(out!.repair.code).toBe('escaped_backtick');
  });

  it('names the fix it made, in words an agent can act on', () => {
    const { repair } = repairJsxSource(escaped)!;
    expect(repair.message).toMatch(/backtick/i);
    expect(repair.message).toMatch(/\\`/);
  });

  it('removes nothing but backslashes', () => {
    const { source } = repairJsxSource(escaped)!;
    expect(source.replace(/`/g, '')).toBe(escaped.replace(/\\`/g, '`').replace(/`/g, ''));
    expect(source).toBe(escaped.replaceAll('\\`', '`'));
  });

  it('leaves a source that already parses completely alone', () => {
    expect(repairJsxSource('<article><p>hi</p></article>')).toBeNull();
  });

  /**
   * The one case a blunt "strip every \\`" would corrupt. It never reaches the
   * repair, because a template literal MAY contain an escaped backtick and so
   * this document parses — the trigger is the parser's own verdict, not a text
   * search.
   */
  it('leaves a legitimate escaped backtick inside a template literal alone', () => {
    const legit = '<article><Helmet><Query name="q">{`select \\` ok`}</Query></Helmet><p>x</p></article>';
    expect(parseJsx(legit).ok, 'this fixture must already parse or it proves nothing').toBe(true);
    expect(repairJsxSource(legit)).toBeNull();
  });

  it('refuses to touch a syntax error that is not this one', () => {
    expect(repairJsxSource('<article><p>hi</p>')).toBeNull();
    expect(repairJsxSource('<article><Question data={{ a: 1 </article>')).toBeNull();
  });

  it('repairs the exact markup the eval captured', () => {
    // Verbatim from the ledger of run 33868923276, the request that was refused.
    const real =
      '<article className="mx-auto max-w-3xl"><h1>Revenue by region</h1><p>Total revenue grew.</p>' +
      '<Helmet><Query name="totals">{\\`select month, sum(revenue) as revenue from ref_JcgHCq group by month order by month\\`}</Query></Helmet>' +
      '<div><Question data="$totals" title="Total revenue per month" /></div></article>';
    const out = repairJsxSource(real);
    expect(out).not.toBeNull();
    expect(parseJsx(out!.source).ok).toBe(true);
    expect(out!.source).toContain('{`select month, sum(revenue) as revenue from ref_JcgHCq group by month order by month`}');
  });
});

/**
 * THE BRACE COUNT — the fault that cost the most model calls in the agent eval: 15 tasks and 82
 * calls across runs 34740707220–34741910427, one `}` at a time. Three shapes, all provable: stray
 * `}`s after an expression that already closed (pi's report, run 34741910427: 13 opens, 15 closes),
 * a `{{{` opening from wrapping an already-wrapped object (pi's second attempt at the same line),
 * and — NOT repaired — an expression that never closes, because where the brace belongs is a guess.
 * Each repair is kept only if the result parses.
 */
describe('repairJsxSource — brace counts', () => {
  const extra = '<article><Question data="$q" viz={{"kind":"vega-lite","spec":{"mark":"line","encoding":{"x":{"field":"m","type":"nominal"}}}}}}} /></article>';
  const triple = '<article><Question data="$q" viz={{{"kind":"vega-lite","spec":{"mark":"line"}}}} /></article>';
  const missing = '<article><Question data="$q" viz={{"kind":"vega-lite","spec":{"mark":"line","encoding":{"x":{"field":"m"}}}} /></article>';
  it('removes stray closing braces after an expression that already closed', () => {
    const out = repairJsxSource(extra);
    expect(out).not.toBeNull();
    expect(parseJsx(out!.source).ok).toBe(true);
    expect(out!.repair.code).toBe('unbalanced_braces');
    expect(out!.repair.message).toMatch(/2 closing brace/);
    expect(out!.source).toContain('"nominal"}}}}} />');
  });
  it('collapses a triple opening brace to one expression wrapper', () => {
    const out = repairJsxSource(triple);
    expect(out).not.toBeNull();
    expect(parseJsx(out!.source).ok).toBe(true);
    expect(out!.source).toContain('viz={{"kind"');
    expect(out!.repair.message).toMatch(/viz=\{\{\{/);
  });
  it('does NOT guess where a missing brace belongs — that stays a named refusal', () => {
    expect(repairJsxSource(missing)).toBeNull();
  });
  it('leaves a document alone when the fault is something else', () => {
    expect(repairJsxSource('<article><p>unclosed</article>')).toBeNull();
  });
});

/**
 * THE SAME FAULT TWICE. The repair used to fix the first `viz={{{` (or the first stray `}`), re-parse
 * ONCE, and refuse everything that still failed — so a document carrying TWO charts built the same
 * wrong way was refused with `fixed:false` and cost three calls to recover (claude-code scrolly,
 * production run 15). An agent that makes a mistake once makes it in every chart it writes, so the
 * repair iterates: fix at the parse error, re-parse, again, bounded — and the message states the
 * TOTAL, because "collapsed 1" against a document with two would teach the wrong lesson.
 */
describe('repairJsxSource — the same fault more than once', () => {
  const twoTriples = [
    '<article>',
    '<Question data="$a" viz={{{"kind":"vega-lite","spec":{"mark":"line"}}}} />',
    '<Question data="$b" viz={{{"kind":"vega-lite","spec":{"mark":"bar"}}}} />',
    '</article>',
  ].join('\n');
  const twoStrays = [
    '<article>',
    '<Question data="$a" viz={{"kind":"line"}}} />',
    '<Question data="$b" viz={{"kind":"bar"}}}} />',
    '</article>',
  ].join('\n');
  const secondMissing = [
    '<article>',
    '<Question data="$a" viz={{"kind":"line"}}} />',
    '<Question data="$b" viz={{"kind":"bar","spec":{"mark":"bar"}} />',
    '</article>',
  ].join('\n');

  it('collapses every `{{{` opening, not the first, and counts them', () => {
    const out = repairJsxSource(twoTriples);
    expect(out, 'two occurrences of one fault are still one repairable document').not.toBeNull();
    expect(parseJsx(out!.source).ok).toBe(true);
    expect(out!.source.includes('{{{')).toBe(false);
    expect(out!.repair.code).toBe('unbalanced_braces');
    expect(out!.repair.message).toMatch(/collapsed 2 `viz=\{\{\{` openings/);
  });

  it('removes stray closing braces at every site and reports the total', () => {
    const out = repairJsxSource(twoStrays);
    expect(out).not.toBeNull();
    expect(parseJsx(out!.source).ok).toBe(true);
    expect(out!.repair.message).toMatch(/removed 3 closing braces/);
    expect(out!.repair.removed).toBe(3);
    // Each site says "line N" IN FULL. The CLI moves a body line onto its file line by rewriting
    // `\bline (\d+)\b` past the YAML fence (cli/src/validation.ts); "on lines 2, 3" matches none of
    // that, and the notice would then name lines that are wrong by the height of the fence.
    expect(out!.repair.message).toContain('on line 2, line 3');
    expect(out!.repair.message).not.toMatch(/\blines \d/);
  });

  it('reports a backtick repair and a brace repair together, never one silently', () => {
    const both =
      '<article><Helmet><Query name="q">{\\`select 1\\`}</Query></Helmet>' +
      '<Question data="$q" viz={{{"kind":"line"}}} /></article>';
    const out = repairJsxSource(both);
    expect(out).not.toBeNull();
    expect(parseJsx(out!.source).ok).toBe(true);
    expect(out!.source).toContain('{`select 1`}');
    expect(out!.source).toContain('viz={{"kind":"line"}}');
    expect(out!.repair.message).toMatch(/backslash/);
    expect(out!.repair.message).toMatch(/viz=\{\{\{/);
  });

  it('still refuses when a later fault is a genuinely missing brace, and the hint names its line', () => {
    expect(repairJsxSource(secondMissing), 'where a missing brace belongs is a guess, however many repairs preceded it').toBeNull();
    const parsed = parseJsx(secondMissing);
    expect(parsed.ok).toBe(false);
    const detail = syntaxErrorDetail(secondMissing, parsed as Extract<typeof parsed, { ok: false }>);
    expect(detail.message).toMatch(/`viz=\{` opened on line 3 is never closed — it needs 1 more `\}`/);
  });
});

/**
 * THE MISSING WRAPPER — the JSON object handed straight to the attribute, with no expression braces
 * of its own: `viz={"kind": "vega-lite", "spec": {…}}`. Measured on the first live leg of the merged
 * build (pi deck, local21 run `deck`): the generator serialized the object and wrote ONE brace, the
 * refusal named it ("the viz attribute is missing its object opening brace"), pi over-corrected to
 * `viz={{{`, inspected, and fixed it — four calls for a shape that is not a guess.
 *
 * It is provable the same way the other two are: an attribute expression whose first non-space
 * character is a JSON key (`"…":`) or `[` is a VALUE where JSX needs an expression, and there is
 * exactly one repair — wrap the whole balanced value in one more brace pair. Anything else stays a
 * refusal, and the wrap is kept only if the document then parses.
 */
describe('repairJsxSource — a JSON value where an expression belongs', () => {
  const one = '<article><Question data="$q" viz={"kind": "vega-lite", "spec": {"mark": "line"}} /></article>';
  const two = [
    '<article>',
    '<Question data="$a" viz={"kind": "vega-lite", "spec": {"mark": "line"}} />',
    '<Question data="$b" viz={"kind": "vega-lite", "spec": {"mark": "bar"}} />',
    '</article>',
  ].join('\n');
  const mixed = [
    '<article>',
    '<Question data="$a" viz={"kind": "vega-lite", "spec": {"mark": "line"}} />',
    '<Question data="$b" viz={{{"kind": "vega-lite", "spec": {"mark": "bar"}}}} />',
    '</article>',
  ].join('\n');
  const broken = '<article><Question data="$q" viz={"kind": "vega-lite", "spec": {"mark": "line"} /></article>';

  it('wraps the value in the one expression it was missing', () => {
    const out = repairJsxSource(one);
    expect(out, 'a JSON value in an attribute is one repair, not a guess').not.toBeNull();
    expect(parseJsx(out!.source).ok).toBe(true);
    expect(out!.source).toContain('viz={{"kind": "vega-lite", "spec": {"mark": "line"}}}');
    expect(out!.repair.code).toBe('unbalanced_braces');
    expect(out!.repair.message).toMatch(/wrapped 1 JSON attribute value/);
    expect(out!.repair.message).toMatch(/on line 1/);
  });

  it('wraps every occurrence and counts them', () => {
    const out = repairJsxSource(two);
    expect(out).not.toBeNull();
    expect(parseJsx(out!.source).ok).toBe(true);
    expect(out!.repair.message).toMatch(/wrapped 2 JSON attribute values/);
    expect(out!.repair.message).toContain('on line 2, line 3');
    expect(out!.source).toContain('"mark": "line"}}}');
    expect(out!.source).toContain('"mark": "bar"}}}');
  });

  it('reports a wrap and a collapsed `{{{` in the same document, each by name', () => {
    const out = repairJsxSource(mixed);
    expect(out).not.toBeNull();
    expect(parseJsx(out!.source).ok).toBe(true);
    expect(out!.repair.message).toMatch(/wrapped 1 JSON attribute value/);
    expect(out!.repair.message).toMatch(/collapsed 1 `viz=\{\{\{` opening/);
    expect(out!.source.includes('{{{')).toBe(false);
  });

  /**
   * `options={["day","week"]}` and `value={[{…}]}` open with `[` and are perfectly legal — the kit's
   * own controls are full of them. The candidate is the attribute the PARSER stopped inside, so a
   * legal array earlier in the document is not touched and does not cost the repair the document
   * actually needs (a wrapped legal array cannot parse, so it would have refused the whole file).
   */
  it('leaves a legal array attribute alone and still repairs the fault further on', () => {
    const legal = '<article><Select value="$g" options={["day","week"]} />' +
      '<Question data="$q" viz={"kind": "vega-lite", "spec": {"mark": "line"}} /></article>';
    const out = repairJsxSource(legal);
    expect(out, 'the real fault is still repairable').not.toBeNull();
    expect(parseJsx(out!.source).ok).toBe(true);
    expect(out!.source).toContain('options={["day","week"]}');
    expect(out!.repair.message).toMatch(/wrapped 1 JSON attribute value/);
    expect(repairJsxSource('<article><Select options={["day","week"]} /><p>ok</p></article>'), 'a document that parses is never touched').toBeNull();
  });

  it('still refuses a value that is genuinely broken, keeping the missing-brace hint', () => {
    expect(repairJsxSource(broken), 'the wrap must parse or the refusal stands').toBeNull();
    const parsed = parseJsx(broken);
    expect(parsed.ok).toBe(false);
    const detail = syntaxErrorDetail(broken, parsed as Extract<typeof parsed, { ok: false }>);
    expect(detail.message).toMatch(/viz attribute is missing its object opening brace/);
  });
});

/**
 * THE DOUBLE BRACE ON AN ARRAY — the object form applied to a value that is not an object.
 * `columns={{[{"col":"team", …}]}}`, measured on the merged build (claude-code dashboard, live leg
 * local23): the door answered "JSX syntax error at line 117, column 78: Unexpected token", no hint,
 * no repair, and it took two calls to inspect and fix. `attr={{` followed by anything that is not an
 * object — an array, a string, a number, true/false/null — is one brace too many on each side, and
 * removing the inner pair is the only repair the shape allows.
 */
describe('repairJsxSource — a JSON array in the object form’s braces', () => {
  const one = '<article><DataTable data="$q" columns={{[{"col":"team","title":"Team"}]}} /></article>';
  const two = [
    '<article>',
    '<DataTable data="$a" columns={{[{"col":"team"}]}} />',
    '<DataTable data="$b" columns={{[{"col":"region"}]}} />',
    '</article>',
  ].join('\n');
  const mixed = [
    '<article>',
    '<DataTable data="$a" columns={{[{"col":"team"}]}} />',
    '<Question data="$b" viz={{{"kind": "vega-lite", "spec": {"mark": "bar"}}}} />',
    '</article>',
  ].join('\n');

  it('removes the extra brace pair and the result parses', () => {
    const out = repairJsxSource(one);
    expect(out, 'an array in double braces is one repair, not a guess').not.toBeNull();
    expect(parseJsx(out!.source).ok).toBe(true);
    expect(out!.source).toContain('columns={[{"col":"team","title":"Team"}]}');
    expect(out!.repair.code).toBe('unbalanced_braces');
    expect(out!.repair.message).toMatch(/unwrapped 1 JSON array attribute value/);
    expect(out!.repair.message).toMatch(/on line 1/);
  });

  it('unwraps every occurrence and counts them', () => {
    const out = repairJsxSource(two);
    expect(out).not.toBeNull();
    expect(parseJsx(out!.source).ok).toBe(true);
    expect(out!.repair.message).toMatch(/unwrapped 2 JSON array attribute values/);
    expect(out!.repair.message).toContain('on line 2, line 3');
    expect(out!.source).toContain('columns={[{"col":"team"}]}');
    expect(out!.source).toContain('columns={[{"col":"region"}]}');
  });

  it('reports an unwrap and a collapsed `{{{` object in the same document, each by name', () => {
    const out = repairJsxSource(mixed);
    expect(out).not.toBeNull();
    expect(parseJsx(out!.source).ok).toBe(true);
    expect(out!.repair.message).toMatch(/unwrapped 1 JSON array attribute value/);
    expect(out!.repair.message).toMatch(/collapsed 1 `viz=\{\{\{` opening/);
    expect(out!.source).toContain('columns={[{"col":"team"}]}');
    expect(out!.source).toContain('viz={{"kind": "vega-lite"');
  });

  /**
   * The scanner reads text, so the same characters INSIDE a `<Query>`'s SQL match it — and that text
   * is content, not markup. The position gate is what keeps the repair off it: the parser stopped at
   * the stray `}` further on, so that is what gets repaired, and the SQL arrives exactly as written.
   * Without the gate this document still parses after the edit, so the corruption would be silent.
   */
  it('never edits the same characters inside a template literal, and repairs the real fault instead', () => {
    const inString = '<article><Helmet><Query name="q">{`select \'columns={{[1]}}\' as note from public.rows`}</Query></Helmet>' +
      '<Question data="$q" viz={{"kind":"table"}}} /></article>';
    const out = repairJsxSource(inString);
    expect(out).not.toBeNull();
    expect(parseJsx(out!.source).ok).toBe(true);
    expect(out!.source).toContain("select 'columns={{[1]}}' as note");
    expect(out!.repair.message).toMatch(/removed 1 closing brace/);
    expect(out!.repair.message).not.toMatch(/unwrapped/);
  });

  /** The object form on an OBJECT is the correct spelling and must survive untouched. */
  it('leaves a legal array attribute and a legal `{{…}}` object alone', () => {
    const legal = '<article><Select value="$g" options={["a","b"]} />' +
      '<Question data="$q" viz={{"kind": "vega-lite", "spec": {"mark": "line"}}} /><p>ok</p></article>';
    expect(parseJsx(legal).ok, 'this fixture must already parse or it proves nothing').toBe(true);
    expect(repairJsxSource(legal)).toBeNull();
    const withFault = '<article><Select options={["a","b"]} /><DataTable columns={{[{"col":"team"}]}} /></article>';
    const out = repairJsxSource(withFault);
    expect(out).not.toBeNull();
    expect(out!.source).toContain('options={["a","b"]}');
    expect(out!.source).toContain('columns={[{"col":"team"}]}');
  });
});
