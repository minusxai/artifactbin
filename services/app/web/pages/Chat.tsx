import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type {
  RemoteSessionInfo,
  RemoteView,
} from "../../../contracts/src/remote";
async function request<T>(
  path: string,
  body?: unknown,
  method = body ? "POST" : "GET",
): Promise<T> {
  const r = await fetch(`/api/remote/sessions${path}`, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Remote session unavailable");
  return data;
}
function SessionTerminal({ id, onClose }: { id: string; onClose: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const [info, setInfo] = useState<RemoteSessionInfo | null>(null);
  const current = useRef<RemoteSessionInfo | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const queue = useRef(Promise.resolve());
  const send = (body: unknown) => {
    const task = queue.current
      .then(() => request(`/${id}`, body))
      .then(() => {
        setError("");
      });
    queue.current = task.catch((e) => {
      setError(e.message);
    });
    return task;
  };
  useEffect(() => {
    const t = new Terminal({
      cursorBlink: true,
      convertEol: false,
      scrollback: 1000,
      fontSize: 13,
      theme: { background: "#111214", foreground: "#e6e6e6" },
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(container.current!);
    terminal.current = t;
    fit.current = f;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>,
      cursor = -1;
    const poll = async () => {
      try {
        const view = await request<RemoteView>(`/${id}?since=${cursor}`);
        if (stopped) return;
        current.current = view.session;
        setInfo(view.session);
        if (view.snapshot !== undefined) {
          t.resize(view.session.cols, view.session.rows);
          t.reset();
          if (view.snapshot)
            await new Promise<void>((r) => t.write(view.snapshot!, r));
        }
        for (const frame of view.frames) {
          t.resize(frame.cols, frame.rows);
          if (frame.data)
            await new Promise<void>((r) => t.write(frame.data, r));
        }
        cursor = view.seq;
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
      if (!stopped) timer = setTimeout(() => void poll(), 250);
    };
    const data = t.onData((data) => {
      if (current.current?.controller === "web" && current.current.online)
        void send({ type: "input", data }).catch(() => {});
    });
    const observer = new ResizeObserver(() => {
      if (current.current?.controller === "web") {
        const size = f.proposeDimensions();
        if (size && (size.cols !== t.cols || size.rows !== t.rows))
          void send({
            type: "control",
            controller: "web",
            cols: Math.max(2, Math.min(300, size.cols)),
            rows: Math.max(2, Math.min(120, size.rows)),
          }).catch(() => {});
      }
    });
    observer.observe(container.current!);
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      observer.disconnect();
      data.dispose();
      t.dispose();
      terminal.current = null;
      current.current = null;
    };
    // A session owns its terminal and ordered input queue for its whole mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const control = async (controller: "web" | "local") => {
    const size = fit.current?.proposeDimensions();
    await send({
      type: "control",
      controller,
      ...(controller === "web" && size
        ? {
            cols: Math.max(2, Math.min(300, size.cols)),
            rows: Math.max(2, Math.min(120, size.rows)),
          }
        : {}),
    });
    if (controller === "web") terminal.current?.focus();
  };
  const online = info?.online ?? false;
  const canType = online && info?.controller === "web";
  return (
    <section className="min-w-0 flex-1">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="font-semibold">{info?.name ?? "Connecting…"}</h2>
          <p className="text-xs text-muted">
            {info?.harness} · {info?.machine} ·{" "}
            {online
              ? `${info?.controller} control`
              : info?.exitCode !== null && info?.exitCode !== undefined
                ? `Exited (${info.exitCode})`
                : "Offline"}
          </p>
        </div>
        <button
          aria-label={canType ? "Release control" : "Take control"}
          disabled={!online}
          className="rounded border border-edge px-3 py-2 disabled:opacity-40"
          onClick={() =>
            void control(canType ? "local" : "web").catch(() => {})
          }
        >
          {canType ? "Release control" : "Take control"}
        </button>
        <button
          aria-label="Disconnect remote session"
          className="rounded border border-edge px-3 py-2"
          onClick={() =>
            void request(`/${id}`, undefined, "DELETE")
              .then(onClose)
              .catch((e) => setError(e.message))
          }
        >
          Disconnect
        </button>
      </div>
      {error && (
        <p role="alert" className="mb-2 text-sm text-red-500">
          {error}
        </p>
      )}
      <div className="overflow-x-auto rounded border border-edge bg-[#111214] p-2">
        <div
          ref={container}
          aria-label="Remote terminal"
          style={{ height: "min(58dvh, 650px)", minHeight: 240 }}
        />
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim() || sending) return;
          setSending(true);
          void send({
            type: "input",
            data: draft.replace(/[\r\n]/g, " ") + "\r",
          })
            .then(() => setDraft(""))
            .catch(() => {})
            .finally(() => setSending(false));
        }}
      >
        <input
          aria-label="Message to agent"
          disabled={!canType || sending}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="min-w-0 flex-1 rounded border border-edge bg-surface p-3"
          placeholder={
            canType ? "Message your agent…" : "Take control to send a message"
          }
          maxLength={16000}
        />
        <button
          aria-label="Send message"
          disabled={!canType || sending || !draft.trim()}
          className="rounded bg-accent px-4 text-bg disabled:opacity-40"
        >
          Send
        </button>
      </form>
      <div className="mt-2 flex flex-wrap gap-2">
        {[
          ["Enter", "\r"],
          ["Escape", "\x1b"],
          ["Tab", "\t"],
          ["↑", "\x1b[A"],
          ["↓", "\x1b[B"],
          ["Ctrl+C", "\x03"],
        ].map(([name, data]) => (
          <button
            key={name}
            aria-label={`Send ${name}`}
            disabled={!canType}
            className="rounded border border-edge px-3 py-2 text-xs disabled:opacity-40"
            onClick={() => void send({ type: "input", data }).catch(() => {})}
          >
            {name}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        Typing in your local terminal takes control back. Disconnect removes
        remote access; your local process keeps running.
      </p>
    </section>
  );
}
export function ChatPage() {
  const [params, setParams] = useSearchParams();
  const id = params.get("session");
  const [sessions, setSessions] = useState<RemoteSessionInfo[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await request<{ sessions: RemoteSessionInfo[] }>("");
        if (!stopped) {
          setSessions(data.sessions);
          setError("");
        }
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
      if (!stopped) timer = setTimeout(() => void poll(), 3000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="mb-1 text-xl font-semibold">Remote sessions</h1>
      <p className="mb-6 text-sm text-muted">
        Your agents, running on your machine.
      </p>
      {error && (
        <p role="alert" className="mb-4 text-sm">
          {error}{" "}
          <a href="/login?callbackUrl=/chat" className="underline">
            Sign in
          </a>
        </p>
      )}
      <div className="flex flex-col gap-6 md:flex-row">
        <aside className="shrink-0 md:w-56">
          {sessions.map((s) => (
            <button
              key={s.id}
              aria-label={`Open ${s.name}`}
              aria-pressed={s.id === id}
              className={`mb-2 block w-full rounded border p-3 text-left ${s.id === id ? "border-accent bg-surface" : "border-edge"}`}
              onClick={() => setParams({ session: s.id })}
            >
              <span className="block truncate">{s.name}</span>
              <span className="text-xs text-muted">
                {s.harness} · {s.online ? "Online" : "Offline"}
              </span>
            </button>
          ))}
          <p className="mt-3 text-xs text-muted">
            Install the CLI:
            <code className="my-2 block break-words rounded border border-edge bg-surface p-2">curl -fsSL https://artifactbin.dev/chat/install.sh | sh</code>
            <a href="/chat/install.sh" className="underline">View install script</a>
            <br />
            Connect your account: <code>afbin auth</code>
            <br />
            Start a session:
            <br />
            <code>afbin remote claude</code>
            <br />
            Type @ in an artifact comment to mention an online session.
          </p>
        </aside>
        {id ? (
          <SessionTerminal
            key={id}
            id={id}
            onClose={() => {
              setParams({});
              setSessions((list) => list.filter((s) => s.id !== id));
            }}
          />
        ) : (
          <div className="rounded border border-edge p-8 text-muted">
            Select a session, or start one from your CLI.
          </div>
        )}
      </div>
    </main>
  );
}
