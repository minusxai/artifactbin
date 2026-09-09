import { useEffect, useRef, useState } from "react";
import { CopyIcon } from "@/components/CopyIcon";
import { Button } from "@/components/ui";
import { useSearchParams } from "react-router";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type {
  RemoteSessionInfo,
  RemoteView,
} from "../../../contracts/src/remote";
class RemoteRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
function connectionMessage(error: unknown) {
  if (error instanceof RemoteRequestError && (error.status === 401 || error.status === 403))
    return "Sign in to reconnect to your sessions.";
  if (error instanceof RemoteRequestError && error.status === 410)
    return "This remote session was disconnected.";
  return "Reconnecting… Retrying automatically.";
}
async function request<T>(
  path: string,
  body?: unknown,
  method = body ? "POST" : "GET",
  signal?: AbortSignal,
): Promise<T> {
  const r = await fetch(`/api/remote/sessions${path}`, {
    method,
    credentials: "same-origin",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    headers: body ? { "Content-Type": "application/json" } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new RemoteRequestError(data?.error ?? "Remote session unavailable", r.status);
  if (!data) throw new Error("Invalid relay response");
  return data;
}
function SessionTerminal({ id, onClose }: { id: string; onClose: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const [info, setInfo] = useState<RemoteSessionInfo | null>(null);
  const current = useRef<RemoteSessionInfo | null>(null);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState("Connecting…");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [resizing, setResizing] = useState(false);
  const queue = useRef(Promise.resolve());
  const send = (body: unknown) => {
    const task = queue.current
      .then(() => request(`/${id}`, body))
      .then(() => {
        setError("");
      });
    queue.current = task.catch((e) => {
      setError(`Could not confirm the action was delivered. Check the terminal before trying again. ${e.message}`);
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
    const abort = new AbortController();
    let failures = 0;
    let generation: string | undefined;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>,
      cursor = -1;
    const poll = async () => {
      try {
        let view = await request<RemoteView>(`/${id}?since=${cursor}`, undefined, "GET", abort.signal);
        if (stopped) return;
        if (generation && view.generation !== generation && view.snapshot === undefined) {
          view = await request<RemoteView>(`/${id}?since=-1`, undefined, "GET", abort.signal);
          if (stopped) return;
        }
        generation = view.generation;
        current.current = view.session;
        setInfo(view.session);
        if (view.snapshot !== undefined) {
          t.resize(view.session.cols, view.session.rows);
          t.reset();
          if (view.snapshot)
            await new Promise<void>((r) => t.write(view.snapshot!, r));
        }
        for (const frame of view.frames) {
          if (stopped) return;
          t.resize(frame.cols, frame.rows);
          if (frame.data)
            await new Promise<void>((r) => t.write(frame.data, r));
        }
        if (stopped) return;
        cursor = view.seq;
        failures = 0;
        setConnection(view.session.online || view.session.exitCode !== null ? "" : "Reconnecting… Waiting for your local terminal.");
      } catch (e) {
        if (!stopped) {
          failures++;
          if (e instanceof RemoteRequestError && e.status === 404) cursor = -1;
          setConnection(connectionMessage(e));
        }
      }
      if (!stopped) timer = setTimeout(() => void poll(), failures ? Math.min(10000, 500 * 2 ** Math.min(failures - 1, 5)) : 250);
    };
    const data = t.onData((data) => {
      if (current.current?.online)
        void send({ type: "input", data }).catch(() => {});
    });
    // xterm's viewport handles wheel input; translate one-finger swipes into
    // scrollback movement without sending arrow keys to the running command.
    const element = container.current!;
    let touchY: number | undefined;
    const touchStart = (event: TouchEvent) => {
      touchY = event.touches.length === 1 ? event.touches[0].clientY : undefined;
    };
    const touchMove = (event: TouchEvent) => {
      if (touchY === undefined || event.touches.length !== 1) return;
      // A desktop-sized screen can be taller than the mobile viewport.
      // Let the outer scroller expose those rows; scroll buttons still reach history.
      const viewport = element.parentElement;
      if (viewport && viewport.scrollHeight > viewport.clientHeight + 1) return;
      const y = event.touches[0].clientY;
      const lines = Math.trunc((touchY - y) / 16);
      if (lines) { t.scrollLines(lines); touchY -= lines * 16; }
      event.preventDefault();
      event.stopPropagation();
    };
    element.addEventListener("touchstart", touchStart, { passive: true });
    element.addEventListener("touchmove", touchMove, { passive: false, capture: true });
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
      abort.abort();
      element.removeEventListener("touchstart", touchStart);
      element.removeEventListener("touchmove", touchMove, true);
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
  const switchView = () => {
    const previous = mobile;
    setResizing(true);
    setMobile(!previous);
    requestAnimationFrame(() => {
      const size = fit.current?.proposeDimensions();
      if (!size) {
        setMobile(previous);
        setResizing(false);
        setError("Could not measure the terminal. Try switching views again.");
        return;
      }
      void send({
        type: "control", controller: "web",
        cols: Math.max(2, Math.min(300, size.cols)),
        rows: Math.max(2, Math.min(120, size.rows)),
      }).catch(() => setMobile(previous)).finally(() => setResizing(false));
    });
  };
  const online = info?.online ?? false;
  const canType = online && !connection;
  const ended = info?.exitCode !== null && info?.exitCode !== undefined;
  return (
    <section className="min-w-0 flex-1">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="font-semibold">{info?.name ?? "Connecting…"}</h2>
          <p className="text-xs text-muted">
            {info?.harness} · {info?.machine} ·{" "}
            {connection || (online
              ? "Online"
              : info?.exitCode !== null && info?.exitCode !== undefined
                ? `Exited (${info.exitCode})`
                : "Offline")}
          </p>
        </div>
        {!ended && <button
          aria-label={mobile ? "Switch to desktop" : "Switch to mobile"}
          disabled={!online || resizing}
          className="rounded border border-edge px-3 py-2 disabled:opacity-40"
          onClick={switchView}
        >
          {mobile ? "Switch to desktop" : "Switch to mobile"}
        </button>}
        <button
          aria-label={ended ? "Remove session" : "Disconnect remote session"}
          className="rounded border border-edge px-3 py-2"
          onClick={() =>
            void request(`/${id}`, undefined, "DELETE")
              .then(onClose)
              .catch((e) => setError(e.message))
          }
        >
          {ended ? "Remove session" : "Disconnect"}
        </button>
      </div>
      {connection && <p role="status" className="mb-2 text-sm text-muted">{connection}</p>}
      {error && (
        <p role="alert" className="mb-2 text-sm text-red-500">
          {error}
        </p>
      )}
      <div style={{ maxWidth: mobile ? 420 : undefined }}>
      {ended && <p role="status" className="mb-3 rounded border border-edge bg-surface p-4 text-sm">
        Session ended (exit {info?.exitCode}). Start a new session with afbin remote to reconnect.
      </p>}
      <div className="overflow-x-auto rounded border border-edge bg-[#111214] p-2" hidden={ended}>
        <div
          ref={container}
          aria-label="Remote terminal"
          style={{ height: "min(58dvh, 650px)", minHeight: 240 }}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-2" aria-label="Terminal scroll controls" hidden={ended}>
        <button className="rounded border border-edge px-3 py-2 text-xs" onClick={() => terminal.current?.scrollPages(-1)}>Scroll up</button>
        <button className="rounded border border-edge px-3 py-2 text-xs" onClick={() => terminal.current?.scrollPages(1)}>Scroll down</button>
        <button className="rounded border border-edge px-3 py-2 text-xs" onClick={() => terminal.current?.scrollToBottom()}>Latest output</button>
      </div>
      {!ended && <form
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
            canType ? "Message your agent…" : "Session offline"
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
      </form>}
      {!ended && <div className="mt-2 flex flex-wrap gap-2">
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
      </div>}
      <p className="mt-3 text-xs text-muted" hidden={ended}>
        Swipe up or down in the terminal to scroll its history, or use the scroll buttons.
        Full-screen agents may manage their own history. Type directly in the terminal or use the message box. The selected terminal size stays in effect
        until you switch views. Disconnect removes
        remote access; your local process keeps running.
      </p>
      </div>
    </section>
  );
}
function CopyCommand({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div>
      <p className="mb-2 text-sm font-medium">{label}</p>
      <div className="flex items-start gap-2 rounded border border-edge bg-surface p-3">
        <code className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs">{command}</code>
        <Button
          type="button"
          aria-label={`Copy ${label.toLowerCase()}`}
          title={copied ? "Copied" : `Copy ${label.toLowerCase()}`}
          className="shrink-0"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(command);
              setCopied(true);
              setError("");
            } catch {
              setError("Could not copy. Select and copy the command above.");
            }
          }}
        >
          <CopyIcon copied={copied} />
        </Button>
      </div>
      <span className="sr-only" role="status">{copied ? "Copied to clipboard" : ""}</span>
      {error && <p role="alert" className="mt-1 text-xs text-muted">{error}</p>}
    </div>
  );
}
function InstallInstructions() {
  const [harness, setHarness] = useState("claude");
  return (
    <div className="mt-4 space-y-4">
      <CopyCommand label="Install CLI" command={'curl -fsSL https://artifactbin.dev/chat/install.sh | sh\nexport PATH="$HOME/.local/bin:$PATH"'} />
      <p className="text-xs text-muted">macOS and Linux · Intel and ARM. Windows: use WSL.</p>
      <p className="text-xs text-muted">Run afbin to sign in and choose an installed agent, or use the explicit command below.</p>
      <div>
        <label htmlFor="remote-harness" className="mb-2 block text-sm">Choose your agent</label>
        <select id="remote-harness" value={harness} onChange={(event) => setHarness(event.target.value)} className="w-full rounded border border-edge bg-surface p-2 text-sm">
          <option value="claude">Claude Code</option>
          <option value="codex">Codex</option>
          <option value="pi">Pi</option>
          <option value="opencode">OpenCode</option>
        </select>
      </div>
      <CopyCommand key={harness} label="Start a session" command={`afbin remote ${harness}`} />
      <p className="text-xs text-muted">Your agent must already be installed. Type @ in an artifact comment to mention an online session.</p>
    </div>
  );
}
export function ChatPage() {
  const [setupExpanded, setSetupExpanded] = useState(false);
  const [params, setParams] = useSearchParams();
  const id = params.get("session");
  const [sessions, setSessions] = useState<RemoteSessionInfo[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    let failures = 0;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await request<{ sessions: RemoteSessionInfo[] }>("", undefined, "GET", abort.signal);
        if (!stopped) {
          failures = 0;
          setSessions(data.sessions);
          setError("");
        }
      } catch (e) {
        if (!stopped) { failures++; setError(connectionMessage(e)); }
      }
      if (!stopped) timer = setTimeout(() => void poll(), failures ? Math.min(10000, 3000 * 2 ** Math.min(failures - 1, 2)) : 3000);
    };
    void poll();
    return () => {
      stopped = true;
      abort.abort();
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
          {error.startsWith("Sign in") && <a href={`/login?callbackUrl=${encodeURIComponent(`/chat${id ? `?session=${id}` : ""}`)}`} className="underline">Sign in</a>}
        </p>
      )}
      <div className="flex flex-col gap-6 md:flex-row">
        <aside className="shrink-0 md:w-80">
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
                {s.harness} · {s.exitCode !== null && s.exitCode !== undefined ? "Ended" : s.online ? "Online" : "Offline"}
              </span>
            </button>
          ))}
          {id && <button
            type="button"
            aria-expanded={setupExpanded}
            aria-controls="cli-setup"
            className="mt-2 flex w-full items-center justify-between rounded border border-edge px-3 py-2 text-sm md:hidden"
            onClick={() => setSetupExpanded((value) => !value)}
          >
            CLI setup <span aria-hidden="true">{setupExpanded ? "−" : "+"}</span>
          </button>}
          <div id="cli-setup" className={id && !setupExpanded ? "hidden md:block" : ""}>
            <InstallInstructions />
          </div>
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
