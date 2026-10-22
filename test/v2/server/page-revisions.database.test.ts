import test from "node:test";
import assert from "node:assert/strict";
import { startServer, page } from "../support/server.ts";
async function fixture(visibility = "public") {
  const server = await startServer(),
    token = await server.token();
  const first = await (
    await server.request("/api/publish", {
      token,
      body: {
        source: page(
          '<h1>Saved one</h1><script data-af="state" type="application/json">{"old":true}</script>',
        ),
        requestId: "history",
        visibility,
      },
    })
  ).json();
  assert.ok(first.id, JSON.stringify(first));
  const updated = await server.request(`/api/files/${first.id}/source`, {
    method: "PUT",
    token,
    headers: { "If-Match": "1" },
    body: {
      source: first.source
        .replace("Saved one", "Current two")
        .replace(
          "</head>",
          '<script data-af="state" type="application/json">{"new":true}</script></head>',
        ),
    },
  });
  assert.equal(updated.status, 200, await updated.clone().text());
  return { server, token, id: first.id, source: first.source };
}
test("saved version remains exact across address bootstrap, source API and readonly hosted representation", async () => {
  const { server, token, id, source } = await fixture();
  try {
    const shell = await (await server.request(`/a/${id}?version=1`)).text();
    const boot = JSON.parse(
      /<script id="pagegi-host" type="application\/json">(.*?)<\/script>/.exec(
        shell,
      )![1]!,
    );
    assert.equal(boot.version, 1);
    assert.equal(boot.sourceUrl, `/api/library/${id}/source?version=1`);
    assert.equal(boot.stateUrl, `/api/library/${id}/host?version=1`);
    const raw = await server.request(boot.sourceUrl);
    assert.equal(raw.status, 200);
    assert.equal(raw.headers.get("etag"), '"1"');
    assert.equal(await raw.text(), source);
    const api = await server.request(`/api/files/${id}/source?version=1`, {
      token,
    });
    assert.equal((await api.json()).source, source);
    const beforeGrants = await server.query(
      "SELECT count(*)::int AS n FROM sessions WHERE purpose='document'",
    );
    const hosted = await (
      await server.request(boot.stateUrl, { token })
    ).json();
    assert.equal(hosted.source, source);
    assert.equal(hosted.version, 1);
    assert.equal(hosted.boot.version, 1);
    assert.equal(hosted.boot.token, null);
    assert.equal(hosted.boot.permissions.edit, false);
    assert.equal(hosted.boot.permissions.comment, false);
    assert.equal(hosted.boot.permissions.manage, false);
    assert.equal(hosted.state.contextOnly, true);
    assert.equal(hosted.state.remote, null);
    assert.equal(hosted.seed, null);
    assert.deepEqual(
      await server.query(
        "SELECT count(*)::int AS n FROM sessions WHERE purpose='document'",
      ),
      beforeGrants,
    );
    const download = await server.request(`/a/${id}?version=1&download=1`);
    assert.equal(download.status, 200);
    const downloaded = await download.text();
    assert.match(downloaded, /Saved one/);
    assert.doesNotMatch(downloaded, /Current two/);
    assert.doesNotMatch(downloaded, /{"new":true}/);
    const refused = await server.request(`/api/files/${id}/source?version=1`, {
      method: "PUT",
      token,
      headers: { "If-Match": "2" },
      body: { source },
    });
    assert.equal(refused.status, 405);
    const current = await (
      await server.request(`/api/library/${id}/host`)
    ).json();
    assert.match(current.source, /Current two/);
    assert.equal(current.version, 2);
    assert.deepEqual(current.seed, { new: true });
    assert.equal(current.state.contextOnly, undefined);
  } finally {
    await server.close();
  }
});
test("invalid or missing saved versions fail consistently and private source authorization is unchanged", async () => {
  const { server, token, id } = await fixture("private");
  try {
    for (const endpoint of [
      `/a/${id}`,
      `/api/library/${id}/source`,
      `/api/library/${id}/host`,
      `/api/files/${id}/source`,
    ]) {
      for (const query of ["version=", "version=no", "version=1&version=2"])
        assert.equal(
          (await server.request(endpoint + "?" + query, { token })).status,
          400,
          endpoint + "?" + query,
        );
      assert.equal(
        (await server.request(endpoint + "?version=999", { token })).status,
        404,
        endpoint,
      );
    }
    const privateSource = await server.request(
      `/api/library/${id}/source?version=1`,
    );
    assert.notEqual(privateSource.status, 200);
    const privateHost = await server.request(
      `/api/library/${id}/host?version=1`,
    );
    assert.notEqual(privateHost.status, 200);
  } finally {
    await server.close();
  }
});

test("library downloads select head or the exact saved revision", async () => {
  const { server, token, id } = await fixture();
  try {
    const options = { token, headers: { "x-pagegi-home": "1" } };
    const head = await server.request(`/api/library/${id}/download`, options);
    assert.equal(head.status, 200);
    assert.match(head.headers.get("content-disposition") || "", /attachment/);
    const headSource = await head.text();
    assert.match(headSource, /Current two/);
    assert.doesNotMatch(headSource, /Saved one/);
    const saved = await server.request(
      `/api/library/${id}/download?version=1`,
      options,
    );
    assert.equal(saved.status, 200);
    const savedSource = await saved.text();
    assert.match(savedSource, /Saved one/);
    assert.doesNotMatch(savedSource, /Current two/);
    for (const query of ["version=", "version=invalid", "version=1&version=2"])
      assert.equal(
        (await server.request(`/api/library/${id}/download?${query}`, options))
          .status,
        400,
      );
    assert.equal(
      (await server.request(`/api/library/${id}/download?version=999`, options))
        .status,
      404,
    );
  } finally {
    await server.close();
  }
});
