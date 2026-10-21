/** The skill's notes example (a page backed by Postgres through its backend), published like the todo example. */
import type { TestServer } from "./server.ts";
import { publishExample, skillExampleFiles, type Example } from "./todo.ts";

/** The backend ID the notes example links; replaced by a reserved one. */
export const NOTES_BACKEND_ID = "Nt7eS2";

export function notesExample(backendId: string): Example {
  return skillExampleFiles("examples/notes.html", "examples/backends/notes.ts", NOTES_BACKEND_ID, backendId);
}

export const publishNotes = (
  server: TestServer,
  token: string,
  body: { requestId: string; visibility?: string; linkRole?: string },
) => publishExample(server, token, body, notesExample);
