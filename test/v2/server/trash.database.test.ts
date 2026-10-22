import { hash } from "../../../src/server/text.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { page, startServer } from "../support/server.ts";
import type { PublishResponse } from "../../../src/server/af-api-contracts.ts";
test("trash disables hosted and source reads, retains history and restores the same ID", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    const published = (await (
      await server.request("/api/publish", {
        token,
        body: {
          source: page("<h1>Retained</h1>"),
          requestId: "trash-history",
          visibility: "public",
        },
      })
    ).json()) as PublishResponse;
    assert.equal(
      (
        await server.request(`/api/files/${published.id}`, {
          token,
          method: "DELETE",
        })
      ).status,
      200,
    );
    assert.equal(
      (await server.request(`/af/v1/ids/${published.id}`)).status,
      404,
    );
    assert.equal(
      (await server.request(`/api/files/${published.id}/source`, { token }))
        .status,
      404,
    );
    assert.equal(
      (
        await server.query(
          "SELECT count(*)::int AS count FROM sources WHERE file_id=$1",
          [published.id],
        )
      ).rows[0]?.count,
      1,
    );
    const entries = (await (
      await server.request("/api/trash", { token })
    ).json()) as { entries: { id: string }[] };
    assert.equal(entries.entries[0]?.id, published.id);
    assert.equal(
      (
        await server.request(`/api/trash/${published.id}/restore`, {
          token,
          body: {},
        })
      ).status,
      200,
    );
    assert.equal(
      (await server.request(`/af/v1/ids/${published.id}`)).status,
      200,
    );
  } finally {
    await server.close();
  }
});

test("folder trash restores nested pages at root when parent is absent and refuses collisions atomically", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    const publish = async (path: string, key: string) => {
      const response = await server.request("/api/publish", {
        token,
        body: { source: page("<p>Kept</p>"), path, requestId: key },
      });
      assert.equal(response.status, 201, await response.clone().text());
      return (await response.json()) as PublishResponse;
    };
    const original = await publish("parent/sub/one.html", "one");
    const second = await publish("parent/sub/deep/two.html", "two");
    const trashed = await server.request("/api/trash/folders", {
      token,
      body: { path: "/parent/sub" },
    });
    assert.equal(trashed.status, 200);
    const batch = (await trashed.json()) as { id: string };
    assert.equal(
      (await server.request(`/af/v1/ids/${second.id}`, { token })).status,
      404,
    );
    await server.request("/api/paths", {
      token,
      body: { kind: "remove-folder", path: "/parent" },
    });
    const collision = await publish("sub/one.html", "collision");
    assert.equal(
      (
        await server.request(`/api/trash/${batch.id}/restore`, {
          token,
          body: {},
        })
      ).status,
      409,
    );
    assert.equal(
      (await server.request(`/af/v1/ids/${second.id}`, { token })).status,
      404,
      "whole subtree stays trashed on failure",
    );
    await server.request(`/api/files/${collision.id}`, {
      token,
      method: "DELETE",
    });
    await server.request("/api/paths", {
      token,
      body: { kind: "remove-folder", path: "/sub" },
    });
    const restored = await server.request(`/api/trash/${batch.id}/restore`, {
      token,
      body: {},
    });
    assert.equal(restored.status, 200, await restored.clone().text());
    const paths = (await (
      await server.request("/api/paths", { token })
    ).json()) as { entries: { path: string; fileId: string }[] };
    assert.equal(
      paths.entries.find((e) => e.fileId === original.id)?.path,
      "sub/one.html",
    );
    assert.equal(
      paths.entries.find((e) => e.fileId === second.id)?.path,
      "sub/deep/two.html",
    );
    assert.equal(
      (
        await server.request(`/api/trash/${batch.id}/restore`, {
          token,
          body: {},
        })
      ).status,
      404,
    );
  } finally {
    await server.close();
  }
});

test("trash management checks fresh group authority and never reveals private history while deleted", async () => {
  const server = await startServer();
  try {
    const editor = await server.token("editor@example.test");
    const viewer = await server.token("viewer@example.test");
    const owner = await server.token("owner@example.test");
    const published = (await (
      await server.request("/api/publish", {
        token: owner,
        body: { source: page("<p>Private</p>"), requestId: "group-trash" },
      })
    ).json()) as PublishResponse;
    await server.query(
      "INSERT INTO accounts(actor,principal_kind) VALUES('group:trash','group')",
    );
    await server.query("INSERT INTO groups(owner) VALUES('group:trash')");
    await server.query(
      "INSERT INTO group_memberships(owner,actor,role) VALUES('group:trash','editor@example.test','editor'),('group:trash','viewer@example.test','viewer')",
    );
    await server.query("UPDATE files SET owner='group:trash' WHERE id=$1", [
      published.id,
    ]);
    assert.equal(
      (
        await server.request(`/api/files/${published.id}`, {
          token: viewer,
          method: "DELETE",
        })
      ).status,
      404,
    );
    assert.equal(
      (await server.request("/api/trash?owner=group:trash", { token: viewer }))
        .status,
      403,
    );
    assert.equal(
      (
        await server.request(`/api/files/${published.id}`, {
          token: editor,
          method: "DELETE",
        })
      ).status,
      200,
    );
    for (const suffix of [
      "source",
      "source?version=1",
      "comments",
      "sharing",
      "backends",
      "graphql",
    ]) {
      const response = await server.request(
        `/api/files/${published.id}/${suffix}`,
        {
          token: editor,
          ...(suffix === "graphql" ? { body: { query: "{ hello }" } } : {}),
        },
      );
      assert.equal(response.status, 404, suffix);
    }
    assert.equal(
      (
        await server.request(`/af/v1/ids/${published.id}?download=1`, {
          token: editor,
        })
      ).status,
      404,
    );
    await server.query(
      "DELETE FROM group_memberships WHERE actor='editor@example.test'",
    );
    assert.equal(
      (
        await server.request(
          `/api/trash/${published.id}/restore?owner=group:trash`,
          { token: editor, body: {} },
        )
      ).status,
      403,
    );
    await server.query(
      "INSERT INTO group_memberships(owner,actor,role) VALUES('group:trash','editor@example.test','editor')",
    );
    assert.equal(
      (
        await server.request(
          `/api/trash/${published.id}/restore?owner=group:trash`,
          { token: editor, body: {} },
        )
      ).status,
      200,
    );
  } finally {
    await server.close();
  }
});

test("every visibility stops serving links and can repeat the trash and restore cycle", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    for (const visibility of ["public", "unlisted", "private"]) {
      const published = (await (
        await server.request("/api/publish", {
          token,
          body: {
            source: page("<p>History</p>"),
            visibility,
            requestId: "visibility-" + visibility,
          },
        })
      ).json()) as PublishResponse;
      for (let cycle = 0; cycle < 2; cycle++) {
        assert.equal(
          (
            await server.request(`/api/files/${published.id}`, {
              token,
              method: "DELETE",
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await server.request(`/api/files/${published.id}`, {
              token,
              method: "DELETE",
            })
          ).status,
          404,
        );
        for (const suffix of ["", "?download=1", "?raw=1"])
          assert.equal(
            (await server.request(`/af/v1/ids/${published.id}${suffix}`))
              .status,
            404,
          );
        assert.equal(
          (
            await server.request(
              `/api/files/${published.id}/source?version=1`,
              { token },
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await server.request(`/api/trash/${published.id}/restore`, {
              token,
              body: {},
            })
          ).status,
          200,
        );
      }
      assert.equal(
        (
          await server.query(
            "SELECT count(*)::int AS n FROM sources WHERE file_id=$1",
            [published.id],
          )
        ).rows[0]?.n,
        1,
      );
    }
  } finally {
    await server.close();
  }
});

test("restoration cannot resurrect a document grant issued before trash", async () => {
  const server = await startServer();
  try {
    const token = await server.token("owner@example.test");
    const published = (await (
      await server.request("/api/publish", {
        token,
        body: { source: page("<p>Grant</p>"), requestId: "grant-trash" },
      })
    ).json()) as PublishResponse;
    const grant = "retained-document-test";
    await server.query(
      "INSERT INTO sessions(token_hash,actor,file_id,generation,expires,purpose) SELECT $1,owner,id,generation,$3,'document' FROM files WHERE id=$2",
      [hash(grant), published.id, Date.now() + 60000],
    );
    assert.equal(
      (
        await server.request(`/api/files/${published.id}/comments`, {
          token: grant,
        })
      ).status,
      200,
    );
    await server.request(`/api/files/${published.id}`, {
      token,
      method: "DELETE",
    });
    await server.request(`/api/trash/${published.id}/restore`, {
      token,
      body: {},
    });
    assert.equal(
      (
        await server.request(`/api/files/${published.id}/comments`, {
          token: grant,
        })
      ).status,
      403,
    );
    assert.equal(
      (await server.request(`/api/files/${published.id}/comments`, { token }))
        .status,
      200,
    );
  } finally {
    await server.close();
  }
});
