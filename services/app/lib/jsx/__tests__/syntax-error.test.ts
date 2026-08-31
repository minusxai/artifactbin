/**
 * The refusal an agent actually acts on.
 *
 * An unbalanced brace inside `viz={{…}}` is the single most common publish
 * failure in the whole agent eval, across three different harnesses: Claude
 * Code failed a deck 21 times and resorted to bisecting with tiny probe
 * documents; Codex recovered in one retry; OpenCode tried twice, gave up, and
 * failed CI. The spec nests four to five levels, agents emit it on one line,
 * and one `}` goes missing.
 *
 * "Unexpected token at line 9, column 191" is true and nearly useless: the
 * column is where the parser NOTICED, not where the mistake is. The opening
 * brace is what needs naming, and it can be computed exactly.
 */
import { describe, expect, it } from 'vitest';
import { parseJsx } from '../parse';
import { syntaxErrorDetail } from '../syntax-error';

const detail = (src: string) => {
  const parsed = parseJsx(src);
  if (parsed.ok) throw new Error('expected a parse failure');
  return syntaxErrorDetail(src, parsed);
};

/** OpenCode's actual markup from the run that failed CI, one `}` short. */
const OPENCODE = `<Helmet>
  <Query name="totals">{\`select month, sum(revenue) total from ref_x group by month\`}</Query>
</Helmet>
<article>
  <Question data="$totals" viz={{"kind":"vega-lite","spec":{"mark":"line","encoding":{"x":{"field":"month","type":"ordinal"},"y":{"field":"total","type":"quantitative"}}}} />
</article>`;

describe('an unclosed expression is named where it OPENS', () => {
  it('names the attribute, the line it started on, and how many braces are missing', () => {
    const d = detail(OPENCODE);
    expect(d.message).toMatch(/viz=/);
    expect(d.message).toMatch(/line 5/);
    expect(d.message).toMatch(/1 more `\}`|missing 1/);
  });

  it('still points at the character the parser tripped on', () => {
    const d = detail(OPENCODE);
    expect(d.snippet).toContain('▶');
  });

  it('counts a bigger deficit correctly', () => {
    const d = detail('<Question viz={{"a":{"b":{"c":1}}} />');
    expect(d.message).toMatch(/1 more `\}`/);
  });

  /** A fault that is NOT an unclosed brace must not be described as one. */
  it('says nothing about braces when the braces balance', () => {
    const d = detail('<div><!-- a comment --></div>');
    expect(d.message).not.toMatch(/more `\}`/);
    expect(d.message).toMatch(/JSX syntax error/);
  });
});
