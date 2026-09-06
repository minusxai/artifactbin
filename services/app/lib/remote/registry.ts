import { randomBytes, randomUUID } from "node:crypto";
import headless from "@xterm/headless";
import serialize from "@xterm/addon-serialize";
import type {
  RemoteSessionInfo,
  RemoteExchange,
  RemoteExchangeResult,
  RemoteView,
  RemoteFrame,
  RemoteInput,
} from "../../../contracts/src/remote";
export type Registration = Pick<
  RemoteSessionInfo,
  "name" | "harness" | "cwd" | "machine" | "cols" | "rows"
>;
export class RemoteError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
interface Session {
  info: RemoteSessionInfo;
  owner: string;
  key: string;
  seen: number;
  terminal: InstanceType<typeof headless.Terminal>;
  serializer: InstanceType<typeof serialize.SerializeAddon>;
  frames: RemoteFrame[];
  bytes: number;
  seq: number;
  inputs: RemoteInput[];
  inputSeq: number;
  events: Set<string>;
  pending: Promise<void>;
}
export function dimensions(cols: number, rows: number) {
  if (
    !Number.isInteger(cols) ||
    cols < 2 ||
    cols > 300 ||
    !Number.isInteger(rows) ||
    rows < 2 ||
    rows > 120
  )
    throw new RemoteError("Invalid terminal dimensions");
}
/** Ephemeral single-process relay. All entry points enforce ownership and bounded retention. */
export class RemoteRegistry {
  private sessions = new Map<string, Session>();
  constructor(readonly now: () => number = Date.now) {}
  private prune() {
    for (const [id, s] of this.sessions)
      if (this.now() - s.seen > 60 * 60 * 1000) {
        s.terminal.dispose();
        this.sessions.delete(id);
      }
  }
  private get(owner: string, id: string): Session {
    this.prune();
    const s = this.sessions.get(id);
    if (!s || s.owner !== owner)
      throw new RemoteError("Session not found", 404);
    return s;
  }
  private info(s: Session): RemoteSessionInfo {
    return {
      ...s.info,
      online: s.info.exitCode === null && this.now() - s.seen < 30000,
    };
  }
  private live(s: Session) {
    if (!this.info(s).online) throw new RemoteError("Session is offline", 409);
  }
  list(userId: string): RemoteSessionInfo[] {
    this.prune();
    return [...this.sessions.values()]
      .filter((s) => s.owner === userId)
      .map((s) => this.info(s));
  }
  create(
    userId: string,
    registration: Registration,
  ): RemoteSessionInfo & { runnerKey: string } {
    dimensions(registration.cols, registration.rows);
    for (const value of [
      registration.name,
      registration.harness,
      registration.cwd,
      registration.machine,
    ])
      if (
        typeof value !== "string" ||
        !value ||
        value.length > 1024 ||
        /[\x00-\x1f\x7f]/.test(value)
      )
        throw new RemoteError("Invalid session details");
    this.prune();
    if (this.list(userId).length >= 10 || this.sessions.size >= 200)
      throw new RemoteError(
        "Session limit reached; disconnect an old session",
        429,
      );
    const terminal = new headless.Terminal({
      cols: registration.cols,
      rows: registration.rows,
      scrollback: 1000,
      allowProposedApi: true,
    });
    const serializer = new serialize.SerializeAddon();
    terminal.loadAddon(serializer);
    const info: RemoteSessionInfo = {
      ...registration,
      id: randomUUID(),
      online: true,
      exitCode: null,
      controller: "local",
      createdAt: new Date(this.now()).toISOString(),
    };
    const key = randomBytes(32).toString("hex");
    this.sessions.set(info.id, {
      info,
      owner: userId,
      key,
      seen: this.now(),
      terminal,
      serializer,
      frames: [],
      bytes: 0,
      seq: 0,
      inputs: [],
      inputSeq: 0,
      events: new Set(),
      pending: Promise.resolve(),
    });
    return { ...info, runnerKey: key };
  }
  async exchange(
    userId: string,
    id: string,
    body: RemoteExchange,
  ): Promise<RemoteExchangeResult> {
    const s = this.get(userId, id);
    if (body.runnerKey !== s.key)
      throw new RemoteError("Invalid runner credential", 403);
    dimensions(body.cols, body.rows);
    if (
      typeof body.output !== "string" ||
      body.output.length > 65536 ||
      !Number.isSafeInteger(body.outputSeq) ||
      body.outputSeq < 0 ||
      body.outputSeq > s.seq + 1 ||
      !Number.isSafeInteger(body.ack) ||
      body.ack < 0 ||
      body.ack > s.inputSeq ||
      (body.exitCode !== undefined && !Number.isInteger(body.exitCode))
    )
      throw new RemoteError("Invalid exchange");
    s.seen = this.now();
    if (body.localControl) {
      s.info.controller = "local";
      s.inputs = s.inputs.filter((i) => i.source === "comment");
    }
    s.inputs = s.inputs.filter((i) => i.id > body.ack);
    if (body.outputSeq > s.seq) {
      s.seq = body.outputSeq;
      s.info.cols = body.cols;
      s.info.rows = body.rows;
      const frame = {
        seq: s.seq,
        data: body.output,
        cols: body.cols,
        rows: body.rows,
      };
      s.frames.push(frame);
      s.bytes += frame.data.length;
      while (s.bytes > 1024 * 1024 || s.frames.length > 1000)
        s.bytes -= s.frames.shift()!.data.length;
      s.pending = s.pending.then(async () => {
        s.terminal.resize(frame.cols, frame.rows);
        if (frame.data)
          await new Promise<void>((resolve) =>
            s.terminal.write(frame.data, resolve),
          );
      });
    }
    if (body.exitCode !== undefined) s.info.exitCode = body.exitCode;
    await s.pending;
    return {
      inputs: s.inputs.map((i) => ({ ...i })),
      controller: s.info.controller,
    };
  }
  async view(userId: string, id: string, since: number): Promise<RemoteView> {
    const s = this.get(userId, id);
    await s.pending;
    const reset =
      since < 0 ||
      since > s.seq ||
      (s.frames.length > 0 && since < s.frames[0].seq - 1);
    return {
      session: this.info(s),
      seq: s.seq,
      frames: reset ? [] : s.frames.filter((f) => f.seq > since),
      ...(reset ? { snapshot: s.serializer.serialize() } : {}),
    };
  }
  private queue(s: Session, input: Omit<RemoteInput, "id">) {
    if (
      s.inputs.length >= 100 ||
      s.inputs.reduce((n, i) => n + (i.data?.length ?? 0), 0) +
        (input.data?.length ?? 0) >
        131072
    )
      throw new RemoteError("Input queue full", 429);
    s.inputs.push({ ...input, id: ++s.inputSeq });
  }
  input(
    userId: string,
    id: string,
    data: string,
    source: "keyboard" | "comment" = "keyboard",
    eventId?: string,
  ): void {
    const s = this.get(userId, id);
    this.live(s);
    if (typeof data !== "string" || !data || data.length > 32768)
      throw new RemoteError("Invalid input");
    if (source === "keyboard" && s.info.controller !== "web")
      throw new RemoteError("Take control before typing", 409);
    if (eventId && s.events.has(eventId)) return;
    this.queue(s, { kind: "input", data, source });
    if (eventId) {
      s.events.add(eventId);
      if (s.events.size > 1000)
        s.events.delete(s.events.values().next().value!);
    }
  }
  control(
    userId: string,
    id: string,
    controller: "local" | "web",
    cols?: number,
    rows?: number,
  ): void {
    const s = this.get(userId, id);
    this.live(s);
    if (controller !== "local" && controller !== "web")
      throw new RemoteError("Invalid controller");
    if (cols !== undefined || rows !== undefined) {
      dimensions(cols!, rows!);
      if (controller === "web")
        this.queue(s, { kind: "resize", cols, rows, source: "keyboard" });
    }
    s.info.controller = controller;
    if (controller === "local")
      s.inputs = s.inputs.filter((i) => i.source === "comment");
  }
  remove(userId: string, id: string): void {
    const s = this.get(userId, id);
    s.terminal.dispose();
    this.sessions.delete(id);
  }
  clear(): void {
    for (const s of this.sessions.values()) s.terminal.dispose();
    this.sessions.clear();
  }
}
export const remoteSessions = new RemoteRegistry();
