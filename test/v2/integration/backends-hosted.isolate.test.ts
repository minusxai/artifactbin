/**
 * A page with a linked backend, opened in the hosted view: the page's backend
 * calls carry the viewer's page grant (or the link's read capability), so
 * each viewer calls the backend as themselves with their role on the page.
 * Needs Postgres, the Docker backend image and Chromium.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Frame, type Page } from "playwright";
import { createBackendHost } from "../../../src/backend/container-host.ts";
import type { PublishResponse } from "../../../src/server/af-api-contracts.ts";
import { page, startServer, type TestServer } from "../support/server.ts";

const LEDGER = `import { gql } from '@afbin/apollo';
export const typeDefs = gql\`
  type Entry { note: String!  by: String }
  type Query { whoami: String }
  type Mutation { record(note: String!): Entry! @auth(role: EDITOR) }
\`;
export default {
  Query: { whoami: (_args, principal) => principal.subject ?? "anonymous" },
  Mutation: { record: ({ note }, principal) => ({ note, by: principal.subject }) },
};
`;
const SCRIPT = `<script type="module">
  import { gql, client } from '@afbin/apollo';
  const read = await client.query({ query: gql\`{ ledger { whoami } }\` });
  const write = await client.mutate({ mutation: gql\`mutation { ledger { record(note: "paid") { note by } } }\` });
  document.querySelector('#result').textContent = JSON.stringify({
    whoami: read.data?.ledger?.whoami ?? null,
    readErrors: (read.errors ?? []).map((e) => e.message),
    outcome: write.extensions?.outcomes?.['ledger.record'] ?? null,
    by: write.data?.ledger?.record?.by ?? null,
  });
</script>`;

interface Result {
  whoami: string | null;
  readErrors: string[];
  outcome: string | null;
  by: string | null;
}

async function open(browser: Browser, server: TestServer, url: string, email: string | null): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/files/") && response.status() >= 400)
      errors.push(`${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`);
  });
  if (email) {
    await page.goto(server.origin + "/");
    const status = await page.evaluate(async (address) => {
      const response = await fetch("/api/auth/test-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: address, browserSession: true }),
      });
      return response.status;
    }, email);
    assert.equal(status, 200);
  }
  await page.goto(url);
  return { page, errors };
}
async function result(page: Page): Promise<Result> {
  for (let attempt = 0; attempt < 150; attempt++) {
    for (const frame of page.frames() as Frame[]) {
      const text = await frame.$eval("#result", (el) => el.textContent).catch(() => "");
      if (text) return JSON.parse(text) as Result;
    }
    await page.waitForTimeout(100);
  }
  throw Error("the page's backend calls did not settle");
}

test("owner, editor and anonymous link viewer call a page's backend from the hosted view with their own roles", async () => {
  const server = await startServer({ backendHost: createBackendHost({}) });
  const browser = await chromium.launch();
  try {
    const owner = await server.token("owner@example.test");
    const ids = (await (
      await server.request("/api/ids", { token: owner, body: { count: 1 }, headers: { "Idempotency-Key": "hosted-backends-1" } })
    ).json()) as { ids: string[] };
    const ledger = ids.ids[0]!;
    const published = (await (
      await server.request("/api/publish", {
        token: owner,
        body: {
          source: page(
            `<p id="result"></p>\n${SCRIPT}`,
            `  <link rel="af-backend" href="https://artifactbin.dev/af/v1/ids/${ledger}" data-af-name="ledger">\n`,
          ),
          files: { [ledger]: LEDGER },
          requestId: "hosted-backends",
          visibility: "unlisted",
          linkRole: "viewer",
        },
      })
    ).json()) as PublishResponse;

    // Share with an editor, who opens the page with no approval step.
    const sharing = (await (await server.request(`/api/files/${published.id}/sharing`, { token: owner })).json()) as {
      policy: { version: number };
    };
    const shared = await server.request(`/api/files/${published.id}/sharing`, {
      method: "PUT",
      token: owner,
      body: { email: "editor@example.test", role: "editor" },
      headers: { "If-Match": String(sharing.policy.version) },
    });
    assert.equal(shared.status, 200, await shared.clone().text());

    const asOwner = await open(browser, server, published.url, "owner@example.test");
    assert.deepEqual(await result(asOwner.page), {
      whoami: "owner@example.test",
      readErrors: [],
      outcome: "committed",
      by: "owner@example.test",
    });
    assert.deepEqual(asOwner.errors, []);

    const asEditor = await open(browser, server, published.url, "editor@example.test");
    assert.deepEqual(await result(asEditor.page), {
      whoami: "editor@example.test",
      readErrors: [],
      outcome: "committed",
      by: "editor@example.test",
    });
    assert.deepEqual(asEditor.errors, []);

    const anonymous = await open(browser, server, published.url, null);
    const seen = await result(anonymous.page);
    assert.equal(seen.whoami, "anonymous");
    assert.deepEqual(seen.readErrors, []);
    assert.equal(seen.outcome, "rejected", "the link's viewer role cannot call an EDITOR mutation");
  } finally {
    await browser.close();
    await server.close();
  }
});
