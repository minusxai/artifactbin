/**
 * THE DESCRIPTION IS THE ROUTE IN. A harness shows an agent only each installed skill's `description`,
 * and the agent decides from that line alone whether to open SKILL.md; SKILL.md then sends it to a
 * starter. So every use case the skill ships a starter for must be named in the description AND routed
 * from SKILL.md, or an agent asked for it never finds the starter. A new starter (an `examples/*.html`,
 * a `scripts/new-*.mjs`, a `new-app.mjs --kind`) fails here until it is given a use case in USE_CASES,
 * with the description words that trigger it and the SKILL.md text that routes to it.
 *
 * Which requests trigger the skill is measured, not asserted: the private eval's routing probes
 * (`npm run eval -- --tasks 'route-*'`) run verbatim requests, should-load and near-miss, in every
 * harness. This pins only what those runs depend on.
 */
import {readdirSync, readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {skillTree} from '..';

const SKILL_DIR = new URL('../../../skills/artifactbin/', import.meta.url);
const skill = skillTree().get('artifactbin/SKILL.md')!;
const description = skill.description;
const body = readFileSync(new URL('SKILL.md', SKILL_DIR), 'utf8').replace(/^---[\s\S]*?\n---\n/, '');

interface UseCase {
  /** What a person asks for. */
  use: string;
  /** Words in the description that make an agent pick the skill up for it. */
  trigger: RegExp;
  /** The starters that serve it, each with the SKILL.md text that routes an agent to it. */
  starters: Record<string, string>;
  /** For a use with no starter: the SKILL.md text that routes it. */
  route?: string;
}

const USE_CASES: UseCase[] = [
  {use: 'a slide deck', trigger: /\bdecks?\b/i, starters: {'examples/deck.html': 'cp examples/deck.html'}},
  {use: 'a team task tracker', trigger: /\btask\s+tracker/i,
    starters: {'examples/tracker.html': 'tracker.html', 'new-app --kind tracker': 'node scripts/new-app.mjs --title'}},
  {use: 'a sign-up sheet, RSVP or roster', trigger: /sign-up sheet/i,
    starters: {'new-app --kind list': 'node scripts/new-app.mjs --kind list'}},
  {use: 'a dashboard, report or chart from a CSV', trigger: /\b(?:report|chart|dashboard)\b[^.]*\bCSV\b/i,
    starters: {'examples/csv-dashboard.html': 'csv-dashboard.html', 'scripts/new-page.mjs': 'node scripts/new-page.mjs --data'}},
  {use: 'a report analysing a codebase', trigger: /report analysing this codebase or repo\b/i,
    starters: {'examples/codebase-report.html': 'codebase-report.html', 'scripts/new-codebase-report.mjs': 'node scripts/new-codebase-report.mjs --repo'}},
  {use: 'a report with no data', trigger: /report[^.]*on a topic with no data/i, starters: {'examples/report.html': 'cp examples/report.html'}},
  {use: 'a doc a team edits together', trigger: /\bdocs?\b[^.]*edits together/i, starters: {}, route: 'references/live-docs.md'},
  {use: 'a landing page', trigger: /landing page/i, starters: {}, route: 'If no starter fits, write the page yourself'},
  {use: 'an Artifactbin page link', trigger: /Artifactbin link \(\/a\/ID\)/, starters: {}, route: 'If the request names an existing page (an ID or /a/ID URL)'},
  {use: "a page's comments", trigger: /comments/i, starters: {}, route: 'node scripts/comment.mjs reply'},
  {use: 'an export', trigger: /export/i, starters: {}, route: 'scripts/export.mjs ID --format html'},
  {use: 'datasets and who may change their rows', trigger: /datasets, who may change their rows/i, starters: {}, route: 'references/permissions.md'},
  {use: 'groups and sharing', trigger: /groups and sharing/i, starters: {}, route: 'node scripts/groups.mjs share'},
];

/** Every starter the tree ships: examples/*.html, scripts/new-*.mjs and new-app.mjs's kinds (its Usage line). */
function shippedStarters(): string[] {
  const examples = readdirSync(new URL('examples/', SKILL_DIR)).filter((f) => f.endsWith('.html')).map((f) => `examples/${f}`);
  const scripts = readdirSync(new URL('scripts/', SKILL_DIR)).filter((f) => /^new-.*\.mjs$/.test(f) && f !== 'new-app.mjs').map((f) => `scripts/${f}`);
  const usage = /--kind ([a-z|]+)\]/.exec(readFileSync(new URL('scripts/new-app.mjs', SKILL_DIR), 'utf8'));
  if (!usage) throw new Error('new-app.mjs: no "[--kind a|b]" in its Usage line');
  return [...examples, ...scripts, ...usage[1]!.split('|').map((kind) => `new-app --kind ${kind}`)];
}

describe('the skill description routes every use case the skill ships', () => {
  it('every shipped starter belongs to exactly one use case', () => {
    const claimed = USE_CASES.flatMap((c) => Object.keys(c.starters));
    for (const starter of shippedStarters()) {
      expect(claimed.filter((s) => s === starter), `${starter} has no use case in USE_CASES: name it in the description and route it from SKILL.md`).toHaveLength(1);
    }
    expect(claimed.filter((s) => !shippedStarters().includes(s)), 'USE_CASES names a starter the tree no longer ships').toEqual([]);
  });

  for (const c of USE_CASES) {
    it(`${c.use}: the description names it and SKILL.md routes it`, () => {
      expect(description, `the description never names ${c.use}`).toMatch(c.trigger);
      for (const [starter, route] of Object.entries(c.starters)) expect(body, `SKILL.md never routes to ${starter}`).toContain(route);
      if (c.route) expect(body).toContain(c.route);
      expect(Object.keys(c.starters).length + (c.route ? 1 : 0), `${c.use} has no route`).toBeGreaterThan(0);
    });
  }

  it('fits every harness: at most 1,024 characters, the request kinds first, and applies without the name Artifactbin', () => {
    // Agent Skills and Pi refuse more than 1,024; Claude Code cuts its listing at 1,536; Codex shortens
    // descriptions from the end when many skills share its budget, so what triggers the skill leads.
    expect(description.length).toBeLessThanOrEqual(1024);
    const lead = description.slice(0, 200);
    for (const kind of ['reports', 'dashboards', 'charts', 'slide decks', 'docs', 'trackers']) expect(lead).toContain(kind);
    // The request rarely names the destination: the description says the skill applies anyway.
    expect(description).toMatch(/even if the user never says Artifactbin/);
    // An agent that explores or asks first decides without the skill: it is loaded before either.
    expect(description).toMatch(/Load it first, before exploring or asking for details/);
  });

  it('names the near misses it is not for: answers in chat, files in a named format and code changes', () => {
    expect(description).toMatch(/Not for questions answered in chat/);
    expect(description).toMatch(/README, PowerPoint, Word/);
    expect(description).toMatch(/code changes/);
  });

  it('every guide says when to read it and is routed from SKILL.md', () => {
    const refs = skillTree().files.filter((f) => f.ref && f.dir === 'artifactbin');
    expect(refs.length).toBeGreaterThan(5);
    for (const ref of refs) {
      expect(body, `SKILL.md never links ${ref.file}`).toContain(`references/${ref.file}`);
      expect(ref.description, `${ref.file}: start its description with when to read it`).toMatch(/^(?:Read (?:before|for|to) |HTTP API without the installed scripts: )/);
    }
  });
});
