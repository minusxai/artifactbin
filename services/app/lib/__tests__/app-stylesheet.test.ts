/**
 * THE APP'S STYLESHEET HAS TO PARSE — the one thing 74 KB of CSS can fail at
 * silently.
 *
 * Tailwind scans the sources `app/globals.css` names. A TEST is not shipped
 * UI, and it is full of strings that look like classes because that is what it
 * asserts about: `content-['@import_url(https://e.example)']`, from the
 * banned-CSS test, compiled to a utility whose text the build's `@import`
 * hoist then lifted to the top of the file. The browser parsed the result into
 * ZERO RULES — every page of the built app unstyled, the document frame back
 * to a bare 300×150 iframe — while `npm run dev` was perfect, because dev
 * never runs that step. Nothing in the suite could see it: no test had ever
 * loaded the built stylesheet.
 *
 * So: compile the real entry against the real sources, and check what comes
 * out is CSS a browser can use.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');

/** The app's own entry, compiled the way the SPA build compiles it. */
async function appStylesheet(): Promise<string> {
  const input = readFileSync(path.join(ROOT, 'app/globals.css'), 'utf8');
  const compiler = await compile(input, { base: path.join(ROOT, 'web'), onDependency: () => {} });
  const scanner = new Scanner({ sources: compiler.sources });
  return compiler.build(scanner.scan());
}

describe('the compiled app stylesheet', () => {
  it('is CSS a browser keeps — rules, not one long mangled line', async () => {
    const css = await appStylesheet();
    expect(css.length).toBeGreaterThan(10_000);
    /*
     * The exact shape of the failure: an `@import` anywhere but the very top
     * is either dead or, once hoisted, the thing that ate the file. The real
     * entry's own `@import 'tailwindcss'` is resolved by then, so ANY left is
     * one a scanned string smuggled in.
     */
    expect(css, 'a smuggled @import — check what the source scan is reading').not.toMatch(/@import/);
    // And the utilities the app is built out of actually reached it.
    for (const rule of ['.block', '.absolute', '.h-full', '.inset-0']) {
      expect(css, `${rule} must be in the app stylesheet`).toContain(rule);
    }
  }, 60_000);

  it('does not carry what a test merely TALKS about', async () => {
    // The candidate that broke it, by name — whatever the globs come to look
    // like, this string must never reach the compiler.
    expect(await appStylesheet()).not.toContain('e.example');
  }, 60_000);
});
