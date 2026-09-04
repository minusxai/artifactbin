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
