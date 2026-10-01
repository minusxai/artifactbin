import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
const worker = fileURLToPath(new URL("./worker.mjs", import.meta.url));
const imports = new Set([
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai/utils/event-stream",
  "abort-controller/dist/abort-controller.mjs",
  "fast-text-encoding",
  "core-js/web/url",
  "core-js/web/structured-clone",
]);
export async function bundleSource(source) {
  if (Buffer.byteLength(source) > 256 * 1024) throw Error("source_limit");
  const out = await build({
    entryPoints: ["program:entry"],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    globalName: "Program",
    logLevel: "silent",
    plugins: [
      {
        name: "fixed-imports",
        setup(b) {
          b.onResolve({ filter: /^program:entry$/ }, () => ({
            path: "entry",
            namespace: "user-program",
          }));
          b.onLoad({ filter: /.*/, namespace: "user-program" }, () => ({
            contents: source,
            loader: "ts",
          }));
          b.onResolve({ filter: /.*/, namespace: "user-program" }, (args) =>
            imports.has(args.path)
              ? {
                  path: fileURLToPath(
                    import.meta.resolve(
                      args.path.startsWith("core-js/")
                        ? args.path + ".js"
                        : args.path,
                    ),
                  ),
                }
              : { errors: [{ text: "import_not_allowed: " + args.path }] },
          );
        },
      },
    ],
  });
  return out.outputFiles[0].text;
}
export async function bundleProgram(filename) {
  return bundleSource(await readFile(filename, "utf8"));
}
export class DesignRunner {
  constructor(db, capabilities) {
    this.db = db;
    this.capabilities = capabilities;
    this.active = new Map();
  }
  async initialize() {
    for (const statement of `CREATE TABLE IF NOT EXISTS design_runs(id text PRIMARY KEY,owner text NOT NULL,request_key text NOT NULL,fingerprint text NOT NULL,status text NOT NULL,data jsonb NOT NULL,receipt jsonb,output jsonb,UNIQUE(owner,request_key));CREATE TABLE IF NOT EXISTS design_events(run_id text NOT NULL,sequence integer NOT NULL,event jsonb NOT NULL,PRIMARY KEY(run_id,sequence));CREATE TABLE IF NOT EXISTS design_conversations(id text PRIMARY KEY,revision integer NOT NULL DEFAULT 0);CREATE TABLE IF NOT EXISTS design_branches(id text PRIMARY KEY,conversation_id text NOT NULL,run_id text NOT NULL UNIQUE,checkpoint jsonb,checkpoint_sequence integer NOT NULL DEFAULT 0,final jsonb);`
      .split(";")
      .filter(Boolean))
      await this.db.query(statement);
  }
  async start(request) {
    if (
      Buffer.byteLength(request.bundle) > 2 * 1024 * 1024 ||
      Buffer.byteLength(JSON.stringify(request.input)) > 256 * 1024
    )
      throw Error("admission_size_limit");
    const fingerprint = createHash("sha256")
        .update(JSON.stringify(request))
        .digest("hex"),
      id = randomUUID();
    const rows = await this.db.query(
      "INSERT INTO design_runs(id,owner,request_key,fingerprint,status,data) VALUES($1,$2,$3,$4,'queued',$5) ON CONFLICT(owner,request_key) DO NOTHING RETURNING id",
      [
        id,
        request.userId,
        request.requestId,
        fingerprint,
        JSON.stringify(request),
      ],
    );
    if (!rows.rows.length) {
      const r = (
        await this.db.query(
          "SELECT id,fingerprint FROM design_runs WHERE owner=$1 AND request_key=$2",
          [request.userId, request.requestId],
        )
      ).rows[0];
      if (r.fingerprint !== fingerprint) throw Error("start_conflict");
      return { runId: r.id };
    }
    let resolve;
    const finished = new Promise((r) => (resolve = r));
    this.active.set(id, {
      request,
      resolve,
      finished,
      revoked: false,
      controllers: new Set(),
      inflight: new Set(),
      sequence: 0,
      requests: 0,
      usage: [],
      network: [],
      eventTail: Promise.resolve(),
    });
    void this.launch(id).catch((error) =>
      this.finish(id, "failed", null, { error: error.message }),
    );
    return { runId: id };
  }
  async launch(id) {
    const run = this.active.get(id);
    const docker = process.env.RUNNER_VALIDATION_DOCKER;
    const child = docker
      ? spawn(
          "docker",
          [
            "run",
            "--rm",
            "--name",
            `runner-validation-${id}`,
            "--label",
            "artifactbin.runner-validation=true",
            "-i",
            "--network",
            "none",
            "--read-only",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--user",
            "1000:1000",
            "--memory",
            "192m",
            "--cpus",
            "1",
            "--pids-limit",
            "32",
            docker,
          ],
          { stdio: ["pipe", "pipe", "pipe"] },
        )
      : spawn(process.execPath, ["--no-node-snapshot", worker], {
          stdio: ["pipe", "pipe", "pipe"],
          env: { PATH: process.env.PATH },
        });
    run.child = child;
    run.started = Date.now();
    run.timer = setTimeout(
      () => void this.stop(id, "timeout"),
      run.request.timeoutMs ?? 3000,
    );
    await this.db.query("UPDATE design_runs SET status='running' WHERE id=$1", [
      id,
    ]);
    let buffered = "";
    const decoder = new StringDecoder("utf8");
    child.stdout.on("data", (bytes) => {
      buffered += decoder.write(bytes);
      if (Buffer.byteLength(buffered) > 2 * 1024 * 1024) {
        void this.finish(id, "failed", null, { error: "ipc_limit" });
        return;
      }
      let end;
      while ((end = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 1);
        try {
          void this.message(id, JSON.parse(line)).catch((error) =>
            this.finish(id, "failed", null, { error: error.message }),
          );
        } catch {
          void this.finish(id, "failed", null, {
            error: "invalid_worker_message",
          });
        }
      }
    });
    child.stderr.on("data", (bytes) => {
      run.stderr = (run.stderr ?? "") + bytes.toString();
    });
    child.on("exit", () => {
      if (!run.revoked) void this.finish(id, "interrupted", null);
    });
    child.on("error", () => void this.finish(id, "interrupted", null));
  }
  async message(id, msg) {
    const run = this.active.get(id);
    if (!run || run.revoked) return;
    if (msg.type === "ready") {
      run.child.stdin.write(
        JSON.stringify({
          type: "run",
          bundle: run.request.bundle,
          input: run.request.input,
          env: run.request.env ?? {},
          memoryMiB: run.request.memoryMiB ?? 64,
          cpuMs: run.request.cpuMs ?? 200,
        }) + "\n",
      );
      return;
    }
    if (msg.type === "result" && run.inflight.size) {
      await this.finish(id, "failed", null, { error: "dangling_capabilities" });
      return;
    }
    if (
      msg.type === "result" &&
      Buffer.byteLength(JSON.stringify(msg.result)) >
        (run.request.maxOutputBytes ?? 1024 * 1024)
    ) {
      await this.finish(id, "failed", null, { error: "output_limit" });
      return;
    }
    if (msg.type === "result") {
      await this.finish(id, "completed", msg.result, { cpuMs: msg.cpuMs });
      return;
    }
    if (msg.type === "error") {
      await this.finish(id, "failed", null, { error: msg.error });
      return;
    }
    if (msg.type !== "call") return;
    run.inflight.add(msg.id);
    try {
      if (++run.requests > (run.request.maxRequests ?? 100))
        throw Error("request_limit");
      const value =
        msg.operation === "emit"
          ? await this.event(id, msg.args)
          : await this.capabilities(id, run, msg.operation, msg.args);
      if (run.revoked) return;
      const encoded = JSON.stringify({ type: "response", id: msg.id, value });
      if (
        Buffer.byteLength(encoded) >
        (run.request.maxResponseBytes ?? 1024 * 1024)
      )
        throw Error("response_limit");
      run.child.stdin.write(encoded + "\n");
    } catch (error) {
      if (!run.revoked)
        run.child.stdin.write(
          JSON.stringify({
            type: "response",
            id: msg.id,
            error: error.message,
          }) + "\n",
        );
    } finally {
      run.inflight.delete(msg.id);
    }
  }
  async event(id, event) {
    const run = this.active.get(id);
    const sequence = ++run.sequence;
    const append = run.eventTail.then(async () => {
      await this.db.query("INSERT INTO design_events VALUES($1,$2,$3)", [
        id,
        sequence,
        JSON.stringify(event),
      ]);
      if (event.type === "checkpoint")
        await this.db.query(
          "UPDATE design_branches SET checkpoint=$2,checkpoint_sequence=$3 WHERE run_id=$1 AND checkpoint_sequence<$3",
          [id, JSON.stringify(event.messages), sequence],
        );
      return { sequence };
    });
    run.eventTail = append;
    return append;
  }
  async finish(id, status, result, extra = {}) {
    const run = this.active.get(id);
    if (!run || run.revoked) return;
    run.revoked = true;
    clearTimeout(run.timer);
    for (const c of run.controllers) c.abort();
    run.child?.kill("SIGKILL");
    if (process.env.RUNNER_VALIDATION_DOCKER)
      await new Promise((resolve) => {
        const rm = spawn("docker", ["rm", "-f", `runner-validation-${id}`], {
          stdio: "ignore",
        });
        rm.on("close", resolve);
        rm.on("error", resolve);
      });
    await run.eventTail;
    const receipt = {
      runId: id,
      status,
      durationMs: Date.now() - run.started,
      requests: run.requests,
      observedRequests: run.network,
      usage: run.usage,
      dollars: null,
      pricingVersion: null,
      ...extra,
    };
    await this.db.query(
      "UPDATE design_runs SET status=$2,receipt=$3,output=$4 WHERE id=$1",
      [id, status, JSON.stringify(receipt), JSON.stringify(result)],
    );
    run.resolve({ status, result, receipt });
  }
  async stop(id, reason = "cancelled") {
    await this.finish(id, reason, null);
  }
  async wait(id) {
    if (this.active.has(id)) return this.active.get(id).finished;
    const row = (
      await this.db.query(
        "SELECT status,output,receipt FROM design_runs WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (!row) throw Error("not_found");
    return { status: row.status, result: row.output, receipt: row.receipt };
  }
  async inspect(id, owner) {
    const row = (
      await this.db.query(
        "SELECT id,status,output,receipt FROM design_runs WHERE id=$1 AND owner=$2",
        [id, owner],
      )
    ).rows[0];
    if (!row) throw Error("not_found");
    return row;
  }
  async commit(id, result) {
    await this.db.transaction(async (tx) => {
      const branch = (
        await tx.query(
          "SELECT * FROM design_branches WHERE run_id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!branch || branch.final) return;
      await tx.query(
        "SELECT id FROM design_conversations WHERE id=$1 FOR UPDATE",
        [branch.conversation_id],
      );
      await tx.query("UPDATE design_branches SET final=$2 WHERE id=$1", [
        branch.id,
        JSON.stringify(result),
      ]);
      await tx.query(
        "UPDATE design_conversations SET revision=revision+1 WHERE id=$1",
        [branch.conversation_id],
      );
    });
  }
  async recover() {
    await this.db.query(
      "UPDATE design_runs SET status='interrupted',receipt=jsonb_build_object('status','interrupted','reason','host_restart') WHERE status IN ('queued','running')",
    );
  }
  async close() {
    for (const id of this.active.keys()) await this.stop(id);
  }
}
