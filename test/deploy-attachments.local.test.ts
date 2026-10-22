import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("attachment bytes mount only in the application with independent private provisioning", async () => {
  const compose = await readFile("deploy/compose.artefactv2.yaml", "utf8");
  const app = compose.split("  pagegi:\n")[1]!.split("\n  execution:")[0]!;
  const execution = compose
    .split("\n  execution:")[1]!
    .split("\n  postgres:")[0]!;
  assert.match(
    app,
    /PAGEGI_DATASET_ATTACHMENT_DIRECTORY: \/run\/pagegi-dataset-attachments/,
  );
  assert.match(
    app,
    /\.\/dataset-attachments:\/run\/pagegi-dataset-attachments:rw/,
  );
  assert.doesNotMatch(execution, /dataset-attachments|env_file/);
  assert.doesNotMatch(app, /docker\.sock/);
  const receiver = await readFile("deploy/receive-artefactv2.sh", "utf8");
  assert.match(receiver, /root=\/opt\/artefactv2/);
  assert.match(
    receiver,
    /install -d -o 1000 -g 1000 -m 0700 "\$root\/dataset-attachments"/,
  );
});
