import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMarkdownLite,
  plainText,
  safeHref,
} from "../src/comments/markdown.ts";
import { personMentionIds } from "../src/comments/presentation.ts";

test("legacy comment Markdown preserves the owned readable subset", () => {
  const nodes = parseMarkdownLite(
    "# Heading\n\n**bold** _emphasis_ `literal`\n\n- one\n- two\n\n> quoted\n\n```js\nconst x = 1;\n```",
  );
  assert.deepEqual(
    nodes.map((n) => n.kind),
    ["heading", "paragraph", "list", "quote", "code_block"],
  );
  assert.match(plainText(nodes), /bold emphasis literal/);
  assert.equal(nodes.at(-1)?.kind, "code_block");
});
test("person mentions come only from parsed links, never code or raw at-text", () => {
  assert.deepEqual(
    personMentionIds(
      "[@saved](/people/stable-1) `[@code](/people/hidden)` @plain\n\n```\n[@fenced](/people/hidden2)\n```",
    ),
    ["stable-1"],
  );
});
test("unsafe links and raw HTML remain literal text; bounded input never executes or fetches", () => {
  for (const href of [
    "javascript:alert(1)",
    "java\tscript:alert(1)",
    "//external.test/path",
    "data:text/html,x",
    "mailto:person@example.test?bcc=hidden@example.test",
    "mailto:person%0a@example.test",
  ])
    assert.equal(safeHref(href), null);
  assert.equal(
    safeHref("https://example.test/path"),
    "https://example.test/path",
  );
  assert.match(
    plainText(parseMarkdownLite("<img src=x onerror=bad()>")),
    /<img/,
  );
  assert.equal(plainText(parseMarkdownLite("x".repeat(10_001))).length, 10_001);
});

test("mailbox links keep their readable legacy label without mail headers", () => {
  for (const value of [
    "mailto:a,b@example.test",
    "mailto:a;b@example.test",
    "mailto:a@example.test,b@example.test",
    "mailto:a@example.test;b@example.test",
  ])
    assert.equal(safeHref(value), null);
  assert.equal(
    safeHref("mailto:reader@example.test"),
    "mailto:reader@example.test",
  );
  const nodes = parseMarkdownLite("[write to me](mailto:reader@example.test)");
  assert.equal(plainText(nodes), "write to me");
  assert.deepEqual(nodes, [
    {
      kind: "paragraph",
      children: [
        {
          kind: "link",
          href: "mailto:reader@example.test",
          children: [{ kind: "text", text: "write to me" }],
        },
      ],
    },
  ]);
});
