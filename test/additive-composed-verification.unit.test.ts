import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  composeAdditiveVerification,
  validateComposedAdditiveVerification,
} from "../src/migration/dataset-pages/composed-verification.ts";
import { standaloneDatasetFixture } from "./support/standalone-dataset.ts";
import {
  additiveRowSha256,
  validateAdditiveVerification,
} from "../src/migration/dataset-pages/additive-authority.ts";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "composed-proof-")),
    { options } = standaloneDatasetFixture(),
    inventory = options.standaloneDatasetPages!.base.inventory;
  inventory.pageReceipts = [
    { key: "fixture:base", digest: "1".repeat(64), pageId: "Base01" },
    { key: "fixture:added", digest: "2".repeat(64), pageId: "Added1" },
  ];
  inventory.datasetAdditiveReceipts = [
    {
      source_namespace: "fixture",
      authority_sha256: "3".repeat(64),
      fingerprint: "4".repeat(64),
      base_fingerprint: inventory.datasetFingerprint,
    },
  ];
  const reports = [];
  for (const name of ["base", "addition"]) {
    const bytes = JSON.stringify({
      complete: true,
      readOnly: true,
      compilerIdentity: "fixture",
      runtime: { pages: 1 },
      archives: [
        { manifestSha256: inventory.baseManifestSha256 },
        { manifestSha256: inventory.relationManifestSha256 },
      ],
    });
    const path = join(dir, name + ".json");
    await writeFile(path, bytes);
    reports.push({ path, sha256: sha(bytes) });
  }
  const base = {
      report: reports[0]!,
      pageIds: ["Base01"],
      pageReceiptsSha256: additiveRowSha256([inventory.pageReceipts[0]]),
    },
    addition = {
      report: reports[1]!,
      pageIds: ["Added1"],
      pageReceiptsSha256: additiveRowSha256([inventory.pageReceipts[1]]),
      datasetReceipt: { ...inventory.datasetAdditiveReceipts[0]! },
    };
  return { dir, inventory, base, addition };
}
test("explicit composed proof binds both real reports, exact disjoint receipts and current facts", async () => {
  const f = await fixture();
  try {
    const proof = await composeAdditiveVerification(
      f.inventory,
      f.base,
      f.addition,
    );
    assert.equal(proof.kind, "verified-additive-composition-v1");
    assert.equal(proof.runtime.pages, 2);
    await validateComposedAdditiveVerification(proof, f.inventory);
    const bytes = JSON.stringify(proof),
      path = join(f.dir, "composed.json");
    await writeFile(path, bytes);
    await validateAdditiveVerification({
      inventory: f.inventory,
      verificationReport: { path, sha256: sha(bytes) },
    });
    const unknown = JSON.stringify({ ...proof, kind: "unrecognized" });
    await writeFile(path, unknown);
    await assert.rejects(() =>
      validateAdditiveVerification({
        inventory: f.inventory,
        verificationReport: { path, sha256: sha(unknown) },
      }),
    );
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});
test("composed proof rejects overlap, missing pages, altered receipts and unknown destination facts", async () => {
  for (const mutation of [
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.addition.pageIds = ["Base01"];
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.addition.pageIds = [];
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.inventory.pageReceipts[1]!.digest = "f".repeat(64);
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.inventory.datasetAdditiveReceipts![0]!.fingerprint = "f".repeat(64);
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.inventory.pageReceipts = [
        ...f.inventory.pageReceipts,
        { key: "fixture:unknown", pageId: "Other1", digest: "f".repeat(64) },
      ];
    },
  ]) {
    const f = await fixture();
    try {
      mutation(f);
      await assert.rejects(() =>
        composeAdditiveVerification(f.inventory, f.base, f.addition),
      );
    } finally {
      await rm(f.dir, { recursive: true, force: true });
    }
  }
});
test("report bytes and captured facts cannot change after composition", async () => {
  const f = await fixture();
  try {
    const proof = await composeAdditiveVerification(
      f.inventory,
      f.base,
      f.addition,
    );
    await writeFile(f.base.report.path, "{}");
    await assert.rejects(() =>
      validateComposedAdditiveVerification(proof, f.inventory),
    );
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
  const g = await fixture();
  try {
    const proof = await composeAdditiveVerification(
      g.inventory,
      g.base,
      g.addition,
    );
    g.inventory.reservedFileIds = ["Other1"];
    await assert.rejects(() =>
      validateComposedAdditiveVerification(proof, g.inventory),
    );
  } finally {
    await rm(g.dir, { recursive: true, force: true });
  }
});
