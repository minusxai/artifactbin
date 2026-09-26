import { describe, expect, it } from 'vitest';
import { AGENT_HELP_TITLE } from '@/lib/agent-discovery-tags';
import { artifactFileCsp, readArtifactFileParts, renderArtifactFileHtml } from '../file-html';
import { artifactFile } from './fixture';

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('renderArtifactFileHtml', () => {
  const file = artifactFile();
  const html = renderArtifactFileHtml({ file, code: 'H4sIAAAAAAAAA0tMTgYAQGCRmgQAAAA=' });

  it('round-trips the file and the code through a parsed document', () => {
    expect(readArtifactFileParts(parse(html))).toEqual({ file, code: 'H4sIAAAAAAAAA0tMTgYAQGCRmgQAAAA=' });
  });

  it('cannot be broken out of by document content', () => {
    const doc = parse(html);
    // the title contains `</script><script>alert(1)</script>`: it must stay data
    expect(doc.querySelectorAll('script:not([type])').length).toBe(1);
    expect(html).not.toContain('</script><script>alert(1)');
  });

  it('locks the network with the CSP and names the document', () => {
    const doc = parse(html);
    const csp = doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content');
    expect(csp).toBe(artifactFileCsp(file.origin));
    expect(csp).toMatch(/default-src 'none'/);
    // One script source beyond the file itself — code view's extras, from the origin the file came from — and no fetches.
    expect(csp).toContain("script-src 'unsafe-inline' https://app.artifactbin.dev;");
    expect(csp).not.toMatch(/connect-src|unsafe-eval|\*/);
    expect(doc.title).toBe(file.metadata.title);
  });

  it('admits only an http(s) origin, as scheme://host[:port], into script-src', () => {
    expect(artifactFileCsp('http://localhost:6001/')).toContain("script-src 'unsafe-inline' http://localhost:6001;");
    expect(artifactFileCsp('https://app.artifactbin.dev/a/x?y')).toContain("script-src 'unsafe-inline' https://app.artifactbin.dev;");
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', "https://x.dev; script-src *", 'not a url']) {
      expect(artifactFileCsp(bad), bad).toMatch(/script-src 'unsafe-inline'(?: https:\/\/x\.dev)?;/);
      expect(artifactFileCsp(bad), bad).not.toMatch(/script-src[^;]*\*/);
    }
  });

  it('references nothing outside the file but the agent help link, which nothing fetches', () => {
    // <link rel="help"> is not a resource: no engine requests it (the offline-file gate counts zero requests).
    const outside = [...html.matchAll(/<[^>]*\s(src|href)="(https?:|\/\/|\/)[^>]*>/g)].map((m) => m[0]);
    expect(outside).toEqual([`<link rel="help" href="https://app.artifactbin.dev/llms.txt" title="${AGENT_HELP_TITLE}">`]);
    expect(html).not.toMatch(/type="module"/);
  });
});

describe('the file, for a coding agent asked to edit it', () => {
  const file = artifactFile({ metadata: { ...artifactFile().metadata, title: 'Q3 --> review <!-- plan' } });
  const html = renderArtifactFileHtml({ file, code: 'H4sIAAAAAAAAA0tMTgYAQGCRmgQAAAA=' });

  it('opens with a note, right after the doctype, that says how to edit it', () => {
    const note = /^<!doctype html>\n<!-- ([\s\S]*?) -->\n<html/.exec(html)?.[1];
    expect(note).toBe(
      'artifactbin offline file for "Q3 - -> review \\u003c!- - plan" (https://app.artifactbin.dev/a/Ab12Cd). '
      + 'To edit the document, change the top-level "source" string (the second key) in the <script id="afbin-file"> JSON below. '
      + 'It is artifactbin JSX (reference: https://app.artifactbin.dev/llms.txt; the afbin CLI: curl -fsSL https://app.artifactbin.dev/chat/install.sh | sh, then "afbin help markup"). '
      + 'Keep the JSON valid and write "<" as \\u003c inside it. '
      + 'Leave "#afbin-code" untouched. '
      + 'The file rebuilds everything else from "source" when it is opened, and shows validation errors if the markup is invalid. '
      + 'Comments are in "threads".',
    );
  });

  it('keeps the note one comment whatever the title holds', () => {
    const doc = parse(html);
    const comments = [...doc.childNodes].filter((n) => n.nodeType === Node.COMMENT_NODE);
    expect(comments).toHaveLength(1);
    expect(doc.documentElement.getAttribute('lang')).toBe('en');
    expect(readArtifactFileParts(doc).file).toEqual(file);
  });

  it('carries the discovery tags every served page carries, on the file\'s origin', () => {
    const doc = parse(html);
    const help = doc.head.querySelector('link[rel="help"]');
    expect(help?.getAttribute('href')).toBe('https://app.artifactbin.dev/llms.txt');
    expect(help?.getAttribute('title')).toBe(AGENT_HELP_TITLE);
    expect(doc.head.querySelector('meta[name="afbin"]')?.getAttribute('content')).toContain('curl -fsSL https://app.artifactbin.dev/chat/install.sh | sh');
  });

  it('puts the JSON before the code, with the top-level source as its second key', () => {
    expect(html.indexOf('id="afbin-file"')).toBeLessThan(html.indexOf('id="afbin-code"'));
    const json = /id="afbin-file">([^<]*)<\/script>/.exec(html)![1]!;
    expect(json.startsWith(`{"format":1,"source":${JSON.stringify(file.source).replace(/</g, '\\u003c')},`)).toBe(true);
    // The first "source" in the text is the one to edit — not base.source.
    expect(json.indexOf('"source"')).toBe(json.indexOf(',"source":') + 1);
  });

  it('still reads a file written in the old order (code, then JSON)', () => {
    const doc = parse(html);
    const code = doc.getElementById('afbin-code')!;
    code.parentNode!.insertBefore(code, doc.getElementById('afbin-file'));
    expect(doc.body.innerHTML.indexOf('afbin-code')).toBeLessThan(doc.body.innerHTML.indexOf('afbin-file'));
    expect(readArtifactFileParts(doc)).toEqual({ file, code: 'H4sIAAAAAAAAA0tMTgYAQGCRmgQAAAA=' });
  });
});
