/**
 * The skill's scripts: skills/pagegi-author/scripts/{add,check,shot,publish,comments,auth}.mjs.
 *
 * Source: src/af-script/af.ts, with one entry file per script
 * (src/af-script/{add,check,shot}.ts). `npm run build:af` bundles them with
 * the page model (src/page/page-model.ts, parse5 included) into three small
 * entry scripts and one shared module, scripts/lib/af-lib.mjs, all committed.
 * They run on Node.js 20.10+ with nothing installed; `shot` also needs Chrome.
 *
 * Scripts (skills/pagegi-author/references/scripts.md holds each script's
 * exact `--help` text):
 *   add.mjs <path>… [--json]
 *                          POST ${AF_SERVER}/api/ids { count } with
 *                          `Authorization: Bearer <token>` (resolveToken in
 *                          ./auth-model.ts) and one `Idempotency-Key` per run;
 *                          on a network error it retries once with the same
 *                          key. Prints one line per path: the path padded to a
 *                          common width, two spaces, the ID (AddJson with
 *                          --json). AF_SERVER defaults to DEFAULT_AF_ORIGIN.
 *                          A path that does not exist exits 2 before any
 *                          request; a path already in .af/ids.json keeps its
 *                          first ID (printed, with a note on stderr) and is
 *                          not reserved again.
 *                          Without a token it exits 2 naming auth.mjs and
 *                          AF_TOKEN; a 401 exits 2 asking to sign in again.
 *   check.mjs <file> [--write-ids] [--json]
 *                          PageModelModule.checkPage. Prints
 *                          `<file>:<line>  <code>  <message>` per problem.
 *                          Exits 1 when any problem (not a warning) is found,
 *                          else 0. With --write-ids it first runs
 *                          PageModelModule.assignNodeIds (the platform's
 *                          algorithm), writes the file if anything changed,
 *                          prints `<file>:<line>  <tag>  <id>` per new ID and
 *                          checks the updated source. If IDs cannot be
 *                          assigned (invalid metadata JSON) it says so, leaves
 *                          the file alone and checks it as it is.
 *   shot.mjs <file> [--width <px>] [--dark] [--design-system <name>] [--out <png>]
 *                          Headless Chrome screenshot of the page with the
 *                          live core from AF_SERVER, or of a static copy with
 *                          the skill's design-systems/<name>.css linked when
 *                          no core is reachable. Chrome is CHROME_PATH when
 *                          set (and only it), else the first standard install
 *                          path that exists. Default width 1280; the PNG is
 *                          exactly --width pixels wide.
 *   publish.mjs <file> [--new|--force|--pull|--delete --yes] [--visibility private|unlisted|public] [--json]
 *   comments.mjs <file|id> [--context|--reply|--on|--edit|--resolve|--reopen|--watch] [--json]
 *                          The page lifecycle; see ./lifecycle-contracts.ts for
 *                          the .af/ sidecar, the journal and their exit codes.
 *                          add.mjs also records its IDs in <cwd>/.af/ids.json.
 *   shot.mjs … --state <file.json> opens the page with `#af-state=` (./state-url.ts).
 *   auth.mjs [--email <address> [--code <code>] | --test-token --email <address> | --logout] [--json]
 *                          Sign in and the credential file; see ./auth-contracts.ts.
 *                          add, publish, comments and secrets send AF_TOKEN, else
 *                          the file's token for AF_SERVER (resolveToken there).
 *   secrets.mjs [set <NAME> | remove <NAME>] [--json]
 *                          The account's secrets, which its backend lambdas read
 *                          as `env` (src/server/secrets-contracts.ts). No command:
 *                          GET /api/secrets, one line per secret (name, then its
 *                          updatedAt; SecretsJson with --json). `set` reads the
 *                          value from standard input, never from an argument,
 *                          drops one trailing newline and sends PUT
 *                          /api/secrets/<NAME> { value }; `remove` sends DELETE.
 *                          A value is never printed. Exit codes as add.mjs,
 *                          plus 1 when the server refuses (404, 422).
 *   --help                 Every script prints its help text and exits 0.
 *
 * Exit codes (add, check, shot): 0 success, 1 `check` found problems (add: an
 * unreadable .af/ids.json), 2 usage or environment error (unknown flag,
 * missing file, missing token, no Chrome, AF_SERVER not a Pagegi server),
 * 3 the server refused or did not answer (add: a non-2xx from /api/ids, or no
 * answer after 3 tries). publish and comments: EXIT in ./lifecycle-contracts.ts.
 *
 * Every script that talks to the server (add, publish, comments, auth) exits 2
 * when AF_SERVER does not look like a Pagegi server: an API route answered 404
 * and so did GET /api/auth/session, which every Pagegi server answers (200 or
 * 401). The message names AF_SERVER and DEFAULT_AF_ORIGIN.
 */
import type { FileId } from "../af-contracts.ts";
import type { NodeIdChange, PageProblem } from "../page/page-contracts.ts";

export type AfScriptName = "add" | "check" | "shot" | "publish" | "comments" | "auth" | "secrets";

export type AfCommand =
  | { kind: "help" }
  | { kind: "add"; paths: string[]; json: boolean }
  | { kind: "check"; file: string; writeIds: boolean; json: boolean }
  | {
      kind: "shot";
      file: string;
      width: number;
      dark: boolean;
      designSystem: string | null;
      out: string;
      /** --state: a JSON file of local state to open the page with (`#af-state=`). */
      state: string | null;
    }
  | { kind: "publish"; file: string; mode: PublishMode; json: boolean; visibility?: import("../contracts.ts").Visibility }
  | { kind: "comments"; target: string; action: CommentsAction; json: boolean }
  | { kind: "auth"; action: import("./auth-contracts.ts").AuthAction; json: boolean }
  | { kind: "secrets"; action: SecretsAction; json: boolean };

export type SecretsAction = { kind: "list" } | { kind: "set"; name: string } | { kind: "remove"; name: string };

/** `secrets --json` output: the server's response as it is (names and times, never a value). */
export type SecretsJson =
  | import("../server/secrets-contracts.ts").SecretsListResponse
  | { secret: import("../server/secrets-contracts.ts").SecretWriteResponse }
  | import("../server/secrets-contracts.ts").SecretDeleteResponse;

/** What one publish.mjs run does: see src/af-script/lifecycle-contracts.ts. */
export type PublishMode = "publish" | "new" | "force" | "pull" | "delete";

export type CommentsAction =
  | { kind: "list" }
  | { kind: "context"; commentId: string }
  | { kind: "comment"; nodeId: string; body: string; quote: string }
  | { kind: "reply"; commentId: string; body: string }
  | { kind: "edit"; commentId: string; body: string }
  | { kind: "resolve"; commentId: string; resolved: boolean }
  | { kind: "watch" };

/** `add --json` output. */
export interface AddJson {
  files: { path: string; id: FileId }[];
}
/** `check --json` output. */
export interface CheckJson {
  file: string;
  problems: PageProblem[];
  /** Only with --write-ids: the IDs added, and whether the file was rewritten. */
  ids?: { written: boolean; changes: NodeIdChange[] };
}
/** Response body of POST /api/ids. */
export interface ReservedIds {
  ids: FileId[];
}

export type AfFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface AfIo {
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  stdout(text: string): void;
  stderr(text: string): void;
  /** Injected HTTP for tests; defaults to the global fetch. */
  fetch?: AfFetch;
  /**
   * URL of the running entry script. `shot` falls back to the skill's
   * design-systems/<name>.css beside the script's folder; without it, it
   * links that CSS from DEFAULT_AF_ORIGIN.
   */
  scriptUrl?: string;
  /** publish and comments: injected ports for tests; real ones by default. */
  ports?: Partial<import("./lifecycle-contracts.ts").LifecyclePorts>;
  /** All of standard input, for `secrets set`; the entry script reads the process's. */
  stdin?: () => Promise<string>;
}

/** Shape of src/af-script/af.ts. */
export interface AfScriptModule {
  /** Throws an Error whose message starts with "Usage" for unknown flags or a missing file argument. */
  parseArguments(script: AfScriptName, argv: readonly string[]): AfCommand;
  /** Runs one script; returns the exit code. Output goes to the given streams. */
  run(script: AfScriptName, argv: readonly string[], io: AfIo): Promise<number>;
}
