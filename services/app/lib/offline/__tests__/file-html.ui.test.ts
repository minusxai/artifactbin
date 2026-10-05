import { describe, expect, it } from 'vitest';
import { AGENT_HELP_TITLE } from '@/lib/serving/agent-discovery-tags';
import { artifactFileCsp, readArtifactFileParts, renderArtifactFileHtml } from '../file-html';
import { artifactFile } from './fixture';

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('renderArtifactFileHtml', () => {
  const file = artifactFile();
  const html = renderArtifactFileHtml({ file, code: 'H4sIAAAAAAAAA0tMTgYAQGCRmgQAAAA=' });

  it('round-trips the file and the code through a parsed document', () => {
    expect(readArtifactFileParts(parse(html))).toEqual({ file, code: 'H4sIAAAAAAAAA0tMTgYAQGCRmgQAAAA=' });
  });

  it('uses the document root theme and color mode on first paint and every saved copy', () => {
    const themed = { ...file, metadata: { ...file.metadata, theme: 'manuscript', colorMode: 'dark' as const } };
    const opened = parse(renderArtifactFileHtml({ file: themed, code: 'AA==' }));
    expect(opened.documentElement.getAttribute('data-theme')).toBe('manuscript');
    expect(opened.documentElement.className).toBe('dark');
    const saved = readArtifactFileParts(opened);
    saved.file.metadata.theme = null;
    saved.file.metadata.colorMode = null;
    const reopened = parse(renderArtifactFileHtml(saved));
    expect(reopened.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(reopened.documentElement.className).toBe('light');
  });

  it('escapes the document root theme without creating another attribute', () => {
    const theme = 'manuscript" onclick="alert(1)';
    const doc = parse(renderArtifactFileHtml({ file: { ...file, metadata: { ...file.metadata, theme } }, code: 'AA==' }));
    expect(doc.documentElement.getAttribute('data-theme')).toBe(theme);
    expect(doc.documentElement.hasAttribute('onclick')).toBe(false);
  });

  it('places the compiled reader output in the file for first paint', () => {
    const compiled = { ...file, compiled: { html: '<h1 data-mx-ast="0">Compiled sales</h1>' } as NonNullable<typeof file.compiled> };
    const doc = parse(renderArtifactFileHtml({ file: compiled, code: 'H4sIAAAAAAAAA0tMTgYAQGCRmgQAAAA=' }));
    expect(doc.querySelector('[data-mx-inline-story] [data-mx-ast="0"]')?.textContent).toBe('Compiled sales');
  });

  it('makes a large compiled module literal addressable by the reader module', () => {
    for (const attribute of ['data-mx-module-data', 'data-mx-module-data=""']) {
      const compiled = { ...file, compiled: { html: `<script type="application/json" ${attribute}>{"moduleData":[]}</script>` } as NonNullable<typeof file.compiled> };
      const doc = parse(renderArtifactFileHtml({ file: compiled, code: 'H4sIAAAAAAAAA0tMTgYAQGCRmgQAAAA=' }));
      expect(doc.getElementById('mx-story-data')?.textContent).toBe('{"moduleData":[]}');
    }
  });

  it('round-trips the packed compiled script and optional SQLite bytes for Save', () => {
    const parts = { file, code: 'H4sIAAAAAAAAA0tMTgYAQGCRmgQAAAA=', compiledCode: 'H4sIAAAAAAAAA0tMTgYAQGCRmgQAAAA=', wasm: 'AA==', templates: { a: '<div>offline</div>' } };
    const doc = parse(renderArtifactFileHtml(parts));
    expect(readArtifactFileParts(doc)).toEqual(parts);
    expect(doc.querySelector('#afbin-compiled-code')?.textContent).toBe(parts.compiledCode);
    expect(doc.querySelector('#afbin-wasm')?.textContent).toBe(parts.wasm);
    expect(doc.querySelector<HTMLTemplateElement>('template[data-mx-island-template="a"]')?.content.textContent).toBe(parts.templates.a);
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
    // WebAssembly compiles (the file's SQLite engine) and nothing else does: exactly 'wasm-unsafe-eval', never 'unsafe-eval'.
    expect(csp).toContain("script-src 'unsafe-inline' 'wasm-unsafe-eval' https://app.artifactbin.dev;");
    expect(csp).not.toMatch(/connect-src|'unsafe-eval'|\*/);
    expect(doc.title).toBe(file.metadata.title);
  });

  it('admits only an http(s) origin, as scheme://host[:port], into script-src', () => {
    expect(artifactFileCsp('http://localhost:6001/')).toContain("script-src 'unsafe-inline' 'wasm-unsafe-eval' http://localhost:6001;");
    expect(artifactFileCsp('https://app.artifactbin.dev/a/x?y')).toContain("script-src 'unsafe-inline' 'wasm-unsafe-eval' https://app.artifactbin.dev;");
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', "https://x.dev; script-src *", 'not a url']) {
      expect(artifactFileCsp(bad), bad).toMatch(/script-src 'unsafe-inline' 'wasm-unsafe-eval'(?: https:\/\/x\.dev)?;/);
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
      + 'It is artifactbin JSX (reference: https://app.artifactbin.dev/llms.txt; prepare Node/npm using https://app.artifactbin.dev/llms.txt, then "npx @afbin/cli@latest help markup"). '
      + 'Keep the JSON valid and write "<" as \\u003c inside it. '
      + 'Leave "#afbin-code" untouched. '
      + 'Static markup/text edits rebuild on open; compiler-dependent widgets require local CLI preview. Invalid markup shows validation errors. '
      + 'To return to JSX, run "npx @afbin/cli@latest import file.jsx.html"; publication is explicit. '
      + 'Comments are in "threads". Save or Cmd/Ctrl+S writes the current edits and comments to a .jsx.html file; the tab stays on the original file. '
      + 'For the full local editor, start "npx @afbin/cli@latest preview" (Windows PowerShell: "npx.cmd @afbin/cli@latest preview"), click "Connect to server", enter the printed server address, and confirm "Import and open" in its tab. A compatible HTTPS preview server also works. This creates a workspace copy, not a publication.',
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
    expect(doc.head.querySelector('meta[name="afbin"]')?.getAttribute('content')).toContain('npx --yes @afbin/cli@latest');
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
