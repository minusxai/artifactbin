import { describe, expect, it } from 'vitest';
import { renderDoc } from '../skills';

const BASE = 'https://example.test';
const publishing = () => renderDoc('artifactbin/references/publishing.md', BASE);
const versions = () => renderDoc('artifactbin/references/publishing-versions.md', BASE);
const annotations = () => renderDoc('artifactbin/references/publishing-annotations.md', BASE);
const brief = () => renderDoc('artifactbin/SKILL.md', BASE);
const flat = (text: string) => text.replace(/\s+/g, ' ');

describe('agent docs: persistent body identity', () => {
  it('requires universal durable body ids and teaches move-without-reuse', () => {
    const text = flat(`${brief()} ${publishing()}`);
    expect(text).toMatch(/every body element.*id/i);
    expect(text).toMatch(/move.*same id/i);
    expect(text).toMatch(/never reuse.*id/i);
    expect(text).toMatch(/lifetime/i);
  });

  it('shows an ID-bearing move as an ordered edit batch', () => {
    const text = versions();
    expect(text).toContain('<Card id=\\"summary-card\\">');
    expect(text).toMatch(/"edits"\s*:\s*\[/);
    expect(text).toMatch(/remove[\s\S]*insert|source[\s\S]*destination/i);
  });
});

describe('agent docs: atomic edit batches', () => {
  it('states the XOR input, limits, order, final-only validation and zero-based failures', () => {
    const text = flat(`${publishing()} ${versions()}`);
    expect(text).toMatch(/old_string.*new_string.*or.*edits/i);
    expect(text).toMatch(/nonempty.*64|1.*64/);
    expect(text).toMatch(/sequential.*in.memory/i);
    expect(text).toMatch(/only the final.*valid/i);
    expect(text).toMatch(/edit_index.*zero.based/i);
  });

  it('states one atomic version and no partial write, including stale unrelated edits', () => {
    const text = flat(`${publishing()} ${versions()}`);
    expect(text).toMatch(/one.*version/i);
    expect(text).toMatch(/no partial|nothing is written/i);
    expect(text).toMatch(/unrelated.*stale|stale.*unrelated/i);
  });
});

describe('agent docs: update versus edit and pure comments', () => {
  it('distinguishes full replacement metadata behavior from targeted edits', () => {
    const text = flat(publishing());
    expect(text).toMatch(/update_artifact.*full replacement/i);
    expect(text).toMatch(/omitted.*title.*description.*keep/i);
    expect(text).toMatch(/edit_artifact.*targeted/i);
  });

  it('describes comments as sidecar relations and legacy anchors as read compatibility only', () => {
    const text = flat(annotations());
    expect(text).toMatch(/sidecar|relation/i);
    expect(text).toMatch(/does not.*rewrite|never.*flush/i);
    expect(text).toMatch(/legacy.*data-annotation-anchor/i);
    expect(text).toMatch(/do not author|never author/i);
  });
});
