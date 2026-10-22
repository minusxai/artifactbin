/** API commands accept a JSON object; absent bodies are an empty command. */
export interface RequestBody {
  [field: string]: unknown;
}
/** Exact file endpoint path, before dispatch or authorization. */
export interface FileRoute {
  readonly fileId: string;
  readonly parts: readonly string[];
}

/** Transport selects an operation; body fields remain untrusted until its service authorizes them. */
export type ApiCommand =
  | { kind: "source.read"; fileId: string }
  | {
      kind: "source.save";
      fileId: string;
      body: RequestBody;
      ifMatch: string | undefined;
      key: RequestHeader;
    }
  | { kind: "comments.list"; fileId: string; since: string | null }
  | {
      kind: "comments.add";
      fileId: string;
      body: RequestBody;
      key: RequestHeader;
    }
  | {
      kind: "comments.edit";
      fileId: string;
      commentId: string;
      ifMatch: string | undefined;
      body: RequestBody;
    }
  | { kind: "comments.capture"; fileId: string; sessionId: unknown }
  | { kind: "comments.context"; fileId: string; commentId: string }
  | {
      kind: "collaboration";
      fileId: string;
      command: import("./collaboration-contracts.ts").CollaborationCommand;
    }
  | {
      kind: "backend";
      fileId: string;
      endpoint: "backends" | "graphql";
      method: string;
      body: RequestBody;
    };
export type RequestHeader = string | readonly string[] | undefined;
export interface ApiCommandRequest {
  method: string;
  url: URL;
  body: RequestBody;
  headers: { ifMatch?: RequestHeader; idempotencyKey?: RequestHeader };
}
