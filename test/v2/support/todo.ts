/**
 * The skill's examples, published the way an agent would: reserve an ID for
 * the backend file, put that ID in the page's link, and publish the page with
 * the backend file.
 */
import type { PublishResponse } from "../../../src/server/af-api-contracts.ts";
import type { BackendHost } from "../../../src/backend/contracts.ts";
import { BackendHostError } from "../../../src/backend/contracts.ts";
import { sealDeployment } from "../../../src/backend/deployment.ts";
import { boundedBackendSchema } from "../../../src/graphql/execution-policy.ts";
import { readBackendModule } from "../../../src/backend/af-module.ts";
import { skillFile } from "./skill.ts";
import type { TestServer } from "./server.ts";

/** The backend ID the todo example links; replaced by a reserved one. */
export const EXAMPLE_BACKEND_ID = "Td4sK9";

export interface Example {
  page: string;
  backend: string;
}

/** A skill example with its backend link pointing at `backendId` instead of the ID in the file. */
export function skillExampleFiles(page: string, backend: string, linkedId: string, backendId: string): Example {
  const source = skillFile(page);
  if (!source.includes(linkedId)) throw Error(`${page} no longer links ${linkedId}`);
  return { page: source.replaceAll(linkedId, backendId), backend: skillFile(backend) };
}

export function todoExample(backendId: string): Example {
  return skillExampleFiles("examples/todo.html", "examples/backends/todos.ts", EXAMPLE_BACKEND_ID, backendId);
}

export async function publishExample(
  server: TestServer,
  token: string,
  body: { requestId: string; visibility?: string; linkRole?: string },
  example: (backendId: string) => Example,
): Promise<PublishResponse & { backendId: string }> {
  const reserved = await server.request("/api/ids", {
    token,
    body: { count: 1 },
    headers: { "Idempotency-Key": "example-backend-" + body.requestId },
  });
  if (reserved.status >= 300) throw Error(`POST /api/ids returned ${reserved.status}`);
  const backendId = ((await reserved.json()) as { ids: string[] }).ids[0]!;
  const files = example(backendId);
  const response = await server.request("/api/publish", {
    token,
    body: { ...body, source: files.page, files: { [backendId]: files.backend } },
  });
  const value = (await response.json()) as PublishResponse & { error?: string };
  if (response.status !== 201) throw Error(`publish returned ${response.status}: ${value.error}`);
  return { ...value, backendId };
}

export const publishTodo = (
  server: TestServer,
  token: string,
  body: { requestId: string; visibility?: string; linkRole?: string },
) => publishExample(server, token, body, todoExample);

/** Compiles backend files in-process (no Docker); for tests that publish but never call a backend. */
export function compileOnlyHost(): BackendHost {
  return {
    async compile(source) {
      const { typeDefs } = await readBackendModule(source);
      const schema = boundedBackendSchema(typeDefs);
      const fields = [
        ...Object.keys(schema.getQueryType()?.getFields() ?? {}),
        ...Object.keys(schema.getMutationType()?.getFields() ?? {}),
      ];
      return sealDeployment(source, `bundle for ${source.length}`, { typeDefs, fields });
    },
    async invoke() {
      throw new BackendHostError("backend_unavailable");
    },
  };
}
