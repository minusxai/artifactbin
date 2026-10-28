import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { admitInitialInlineScripts } from "../inline-scripts";
import { assembleHtmlPage, downloadableHtml } from "../index";
import { recoverPortableSource } from "../portable-source";
const hash = (source: string) =>
  `'sha256-${createHash("sha256").update(source).digest("base64")}'`;
it("admits exact classic/module/import-map code and decoded initial handlers without treating data or inert templates as scripts", () => {
  const admission = admitInitialInlineScripts(
    '<script>classic()</script><script type="module">module()</script><script type="importmap">{"imports":{}}</script><script type="application/json">{"state":1}</script><script src="./main.js">fallback()</script><template><script>inert()</script></template><button onclick="run(&quot;yes&quot;)">Run</button>',
  );
  expect(admission.scriptHashes).toEqual([
    hash("classic()"),
    hash("module()"),
    hash('{"imports":{}}'),
  ]);
  expect(admission.handlerHashes).toEqual([hash('run("yes")')]);
  expect(admission.policy).not.toContain("'unsafe-inline'");
  expect(admission.policy).not.toContain("'unsafe-eval'");
  expect(admission.policy).toContain(
    "script-src-attr 'unsafe-hashes' " + hash('run("yes")'),
  );
});
it("hashes browser-normalized text, deduplicates code and forbids new handlers when none were authored", () => {
  const admission = admitInitialInlineScripts(
    "<script>a\r\nb</script><script>a\nb</script>",
  );
  expect(admission.scriptHashes).toEqual([hash("a\nb")]);
  expect(admission.policy).toContain("script-src-attr 'none'");
});
it("installs admission before every script, refreshes platform hashes on assembly and preserves portable canonical source", () => {
  const source =
      "<html><head><script>author()</script></head><body>Hello</body></html>",
    input = {
      html: source,
      core: "oldCore()",
      config: { pageId: "p", revision: "1", backends: [] },
    };
  const first = assembleHtmlPage(input);
  expect(first.indexOf('data-af="script-policy"')).toBeLessThan(
    first.indexOf("<script"),
  );
  expect(first).toContain(hash("oldCore()"));
  const second = assembleHtmlPage({ ...input, html: first, core: "newCore()" });
  expect(second.match(/data-af="script-policy"/g)).toHaveLength(1);
  expect(second).not.toContain(hash("oldCore()"));
  expect(second).toContain("newCore()");
  const portable = downloadableHtml(input);
  expect(recoverPortableSource(portable)).toBe(source);
});

it("admits a validated platform nonce without granting it to authored handlers", () => {
  const nonce = "freshPlatformNonce123456789";
  const policy = admitInitialInlineScripts("<script>author()</script>", nonce);
  expect(policy.policy).toContain("'nonce-" + nonce + "'");
  expect(policy.policy).toContain("script-src-attr 'none'");
  expect(() => admitInitialInlineScripts("", "bad' unsafe-inline")).toThrow();
  const html = assembleHtmlPage({
    html: "<script>author()</script>",
    core: "core()",
    platformScriptNonce: nonce,
    config: { pageId: "p", revision: "1", backends: [] },
  });
  expect(html).toContain('data-af="core" nonce="' + nonce + '"');
  expect(html).not.toContain('<script nonce="' + nonce + '">author()');
});

it("preserves legacy language while parameterized and inactive types cannot grant script admission", () => {
  const admitted = admitInitialInlineScripts(
    '<script type="text/javascript; charset=utf-8">mime()</script><script language="javascript">legacy()</script><script language="json">inactive()</script><script type="module; invalid">inactiveModule()</script>',
  );
  expect(admitted.scriptHashes).toEqual([hash("legacy()")]);
});

it("declares UTF-8 before portable code so non-ASCII script bytes retain their admitted CSP identity",()=>{
 const source='<html><head><meta charset="windows-1252"></head><body><script type="module">globalThis.label="î → Done";</script></body></html>';
 const output=downloadableHtml({html:source,core:'/*'+'x'.repeat(2048)+'*/',config:{pageId:'p',revision:'1',backends:[]}});
 expect(output.indexOf('<meta charset="utf-8">')).toBeGreaterThan(-1);
 expect(output.indexOf('<meta charset="utf-8">')).toBeLessThan(1024);
 expect(output.indexOf('<meta charset="utf-8">')).toBeLessThan(output.indexOf('<script'));
 expect(output).not.toContain('charset="windows-1252"');
 expect(output).toContain(hash('globalThis.label="î → Done";'));
 expect(recoverPortableSource(output)).toBe(source);
});
