import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_AF_ORIGIN, DEFAULT_DESIGN_SYSTEM, DESIGN_SYSTEMS } from "../../../src/af-contracts.ts";
import type { AppearanceModule } from "../../../src/browser/core/core-contracts.ts";
import { load } from "../support/load.ts";
import { skillFile } from "../support/skill.ts";

const appearance = () => load<AppearanceModule>("src/browser/core/appearance.ts");
const none = { pageDesignSystem: null, viewerDesignSystem: null, viewerDark: null, systemDark: false };

test("the SKILL.md file-state table lists exactly the platform's design systems", () => {
  const row = /\| `data-af-design-system` \| ([^|]+) \|/.exec(skillFile("SKILL.md"));
  assert.ok(row);
  assert.deepEqual(row[1]!.trim().split(/,\s*/).map((name) => name.replaceAll("`", "")), [...DESIGN_SYSTEMS]);
});

test("the viewer's pick wins, then the page's, then meridian", async () => {
  const { resolveAppearance } = await appearance();
  assert.deepEqual(resolveAppearance(none), { designSystem: DEFAULT_DESIGN_SYSTEM, dark: false });
  assert.equal(DEFAULT_DESIGN_SYSTEM, "meridian");
  assert.equal(resolveAppearance({ ...none, pageDesignSystem: "dossier" }).designSystem, "dossier");
  assert.equal(resolveAppearance({ ...none, pageDesignSystem: "dossier", viewerDesignSystem: "riso" }).designSystem, "riso");
  assert.equal(resolveAppearance({ ...none, pageDesignSystem: "nope", viewerDesignSystem: "also-nope" }).designSystem, "meridian");
});

test("dark mode follows the viewer's choice, else the system", async () => {
  const { resolveAppearance } = await appearance();
  assert.equal(resolveAppearance({ ...none, systemDark: true }).dark, true);
  assert.equal(resolveAppearance({ ...none, systemDark: true, viewerDark: false }).dark, false);
  assert.equal(resolveAppearance({ ...none, viewerDark: true }).dark, true);
});

test("html attributes: data-af-dark is \"true\" in dark mode and absent otherwise", async () => {
  const { htmlAttributes } = await appearance();
  assert.deepEqual(htmlAttributes({ designSystem: "dossier", dark: true }), {
    "data-af-design-system": "dossier",
    "data-af-dark": "true",
  });
  assert.deepEqual(htmlAttributes({ designSystem: "volta", dark: false }), {
    "data-af-design-system": "volta",
    "data-af-dark": null,
  });
});

test("the design-system link and the import map", async () => {
  const { designSystemHref, importMap } = await appearance();
  const example = /<link rel="stylesheet" href="([^"]+)" data-af="design-system">/.exec(skillFile("SKILL.md"));
  assert.ok(example);
  assert.equal(designSystemHref(DEFAULT_AF_ORIGIN, "dossier"), example[1]);
  assert.deepEqual(importMap({ apollo: "blob:x" }), { imports: { "@afbin/apollo": "blob:x" } });
});
