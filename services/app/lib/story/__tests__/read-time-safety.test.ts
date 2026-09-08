import { describe, expect, it } from 'vitest';
import { storyBodyFor } from '../body';

/** Stored rows are untrusted, including rows predating today's publish gate.
 * The same reader feeds SSR, client bootstrap and live replacements. */
describe('stored markup safety at the shared rendering boundary', () => {
  it.each([
    '<script>window.legacyExecuted=true</script><p>Legacy</p>',
    '<img src="x" onError="alert(1)" />',
    '<a href="javascript:alert(1)">Open</a>',
    '<iframe srcDoc="hello" />',
    '<div dangerouslySetInnerHTML={{ __html: "<script>alert(1)</script>" }} />',
    '<Helmet><meta http-equiv="refresh" content="0;url=https://example.org" /></Helmet><p>Text</p>',
  ])('refuses unsafe historical source: %s', (source) => {
    expect(storyBodyFor(source)).toBeNull();
  });

  it('retains valid prose and persistent node IDs', () => {
    const result = storyBodyFor('<section id="section1"><p id="paragraph1">Safe</p></section>');
    expect(result).not.toBeNull();
    expect(JSON.stringify(result?.body)).toContain('paragraph1');
  });

  it('keeps a valid author script inert in the Helmet payload', () => {
    const result = storyBodyFor('<Helmet><script>{`mx.params.set("ready", true);`}</script></Helmet><p>Safe</p>');
    expect(result?.content.script).toBe('mx.params.set("ready", true);');
    expect(result?.body.some(n => n.type === 'element' && n.tag === 'script')).toBe(false);
  });
});
