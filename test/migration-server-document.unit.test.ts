import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareInactiveServerDocument } from "../src/migration/server-document.ts";
import { convertLegacyJsx } from "../src/migration/conversion/index.ts";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const handler =
  'throw Error("never evaluate"); export default async function(){return 1}';
const script = `<script type="server">{${JSON.stringify(handler)}}</script>`;
test("explicit inactive view preserves exact archive identity and ordinary body without evaluating handler", () => {
  const source = `<Helmet><title>Archived example</title>${script}</Helmet><h1 id="heading">Visible content</h1>`;
  const view = prepareInactiveServerDocument(source, {
    mode: "archived-inactive",
  });
  assert.equal(view.originalSourceSha256, hash(source));
  assert.equal(view.handler.sourceSha256, hash(handler));
  assert.equal(view.handler.status, "archived-inactive");
  assert.equal(view.renderSource, source.replace(script, ""));
  assert.equal(
    view.limitation,
    "Archived server handler is unavailable; execution is not enabled.",
  );
  assert.equal("classification" in view, false);
  assert.equal("factorySource" in view, false);
  assert.equal(JSON.stringify(view).includes("never evaluate"), false);
  // Existing whole-source admission is unchanged; the view does not install a fallback.
  assert.equal(
    convertLegacyJsx({ source, coreUrl: "/af/v1/core.js" }).classification,
    "manual-blocked",
  );
});
test("dataset declarations and controls remain distinct from inactive server invocation", () => {
  const source = `<Helmet>${script}<Mutation name="rename">{\`update tasks.rows set name=$name\`}</Mutation></Helmet><Button id="save" run="$rename">Save data</Button>`;
  const view = prepareInactiveServerDocument(source, {
    mode: "archived-inactive",
  });
  assert.deepEqual(view.body, {
    declaredDatasetMutations: 1,
    mutationControls: 1,
  });
  assert.match(view.renderSource, /<Mutation/);
  assert.match(view.renderSource, /run="\$rename"/);
  assert.equal(view.handler.reason, "execution-not-enabled");
});
test("browser code is retained as source for its separate admission and never evaluated", () => {
  const browser =
    '<script type="module">{`throw Error("browser also not evaluated")`}</script>';
  const view = prepareInactiveServerDocument(
    `<Helmet>${script}${browser}</Helmet><p>Body</p>`,
    { mode: "archived-inactive" },
  );
  assert.match(view.renderSource, /browser also not evaluated/);
  assert.equal(view.handler.sourceSha256, hash(handler));
});
test("inactive view refuses implicit mode, ambiguous or dynamic script extraction", () => {
  const bad = [
    `<Helmet>${script}${script}</Helmet>`,
    `<div>${script}</div>`,
    `<Helmet><script type="server">{makeHandler()}</script></Helmet>`,
    `<Helmet><script type="server" src="external">{\`code\`}</script></Helmet>`,
    `<Helmet><script type="server">{\`code ${"${value}"}\`}</script></Helmet>`,
    `<p>No server handler</p>`,
  ];
  for (const source of bad)
    assert.throws(() =>
      prepareInactiveServerDocument(source, { mode: "archived-inactive" }),
    );
  assert.throws(() =>
    prepareInactiveServerDocument(
      `<Helmet>${script}</Helmet>`,
      undefined as any,
    ),
  );
});
