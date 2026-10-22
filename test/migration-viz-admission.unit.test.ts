import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { admitStandaloneVizSources } from "../src/migration/viz-pages/admission.ts";
import { additiveRowSha256 } from "../src/migration/dataset-pages/additive-authority.ts";
import type {
  LegacyArtifact,
  MigrationManifest,
} from "../src/migration/contracts.ts";
import type { StandaloneVizJobAdmission } from "../src/migration/viz-pages/admission-contracts.ts";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
function fixture() {
  const row = {
    id: "recipe",
    version: 2,
    format: "viz",
    title: "Recipe",
    source: '{"engine":"vega-lite","slots":[]}',
    deleted_at: null,
    user_id: "owner",
    group_id: null,
    token_id: null,
    document: null,
    visibility: "private",
    link_role: "viewer",
  } satisfies LegacyArtifact;
  const old = {
    ...row,
    artifact_id: row.id,
    version: 1,
    source: '{"engine":"vega","slots":[]}',
  };
  const manifest = {
    sourceNamespace: "test",
    artifacts: [row],
    tables: { artifact_versions: [old] },
    tokenOwners: [],
  } as unknown as MigrationManifest;
  const admission = {
    kind: "standalone-viz-pages-v1",
    sourceNamespace: "test",
    heads: [
      {
        legacyId: "recipe",
        pageId: "Rcp123",
        version: 2,
        artifactSha256: additiveRowSha256(row),
        sourceSha256: sha(row.source as string),
        versions: [
          { version: 1, artifactSha256: additiveRowSha256(old) },
          { version: 2, artifactSha256: additiveRowSha256(row) },
        ],
      },
    ],
  } satisfies Pick<
    StandaloneVizJobAdmission,
    "kind" | "sourceNamespace" | "heads"
  >;
  return {
    manifest,
    admission,
    maps: { pages: { recipe: "Rcp123" }, users: {}, tokens: {}, groups: {} },
  };
}
test("viz admission preserves exact historical and current source versions", () => {
  const f = fixture();
  assert.deepEqual(
    admitStandaloneVizSources([f.manifest], f.maps, f.admission).map(
      (x) => x.version,
    ),
    [1, 2],
  );
});
test("viz admission rejects changed source, missing history, remapped IDs and non-viz authority", () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      f.manifest.artifacts[0]!.source += " ";
    },
    (f: ReturnType<typeof fixture>) => {
      f.manifest.tables.artifact_versions = [];
    },
    (f: ReturnType<typeof fixture>) => {
      f.maps.pages.recipe = "Other1";
    },
    (f: ReturnType<typeof fixture>) => {
      f.manifest.artifacts[0]!.format = "markup";
    },
    (f: ReturnType<typeof fixture>) => {
      f.manifest.artifacts[0]!.deleted_at = "now";
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() =>
      admitStandaloneVizSources([f.manifest], f.maps, f.admission),
    );
  }
});
test("viz admission refuses duplicate or unadmitted product scope", () => {
  const f = fixture();
  assert.throws(() =>
    admitStandaloneVizSources([f.manifest, f.manifest], f.maps, f.admission),
  );
  const g = fixture();
  g.admission.heads = [];
  assert.throws(() =>
    admitStandaloneVizSources([g.manifest], g.maps, g.admission),
  );
});
