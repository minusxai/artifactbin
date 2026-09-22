import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Tooltip } from "./Tooltip";
import {REMOTE_COLOR_CSS,remoteColor,type RemoteSessionInfo } from "../../contracts/src/remote";
const connectionRequest = "Connect to afbin remote so I can @mention you in artifact comments.";
export interface MentionPickerHandle { keyDown: (key: string) => boolean }
const agentLabel = (name: string) => (({ claude: "Claude Code", codex: "Codex", pi: "Pi", opencode: "OpenCode" } as Record<string, string>)[name] ?? name);
export default forwardRef<MentionPickerHandle, { query: string; onSelect: (text: string) => void }>(function RemoteMentionPicker({
  query,
  onSelect,
}: {
  query: string;
  onSelect: (text: string) => void;
}, ref) {
  const [sessions, setSessions] = useState<RemoteSessionInfo[]>([]);
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [query]);
  const [loaded, setLoaded] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const copyRequest = async () => {
    try {
      await navigator.clipboard.writeText(connectionRequest);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  };
  useEffect(() => {
    const abort = new AbortController();
    void fetch("/api/remote/sessions", {
      signal: abort.signal,
      credentials: "same-origin",
    })
      .then((r) => (r.ok ? r.json() : { sessions: [] }))
      .then((data) => {
        setSessions(data.sessions);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => abort.abort();
  }, []);
  const matches = sessions.filter(
    (s) =>
      (s.managed?s.exitCode===null&&s.activity!=='stopped':s.online) &&
      `${s.name} ${s.harness}`.toLowerCase().includes(query.toLowerCase()),
  );
  const choose = (s: RemoteSessionInfo) => onSelect(`[@${s.name.replace(/[\[\]\\\n]/g, "")}](/chat?session=${s.id}) `);
  useImperativeHandle(ref, () => ({ keyDown(key) {
    if (!matches.length) return false;
    if (key === "ArrowDown" || key === "ArrowUp") {
      setActive(i => (i + (key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
      return true;
    }
    if (key === "Enter" || key === "Tab") { choose(matches[active % matches.length]); return true; }
    return false;
  }}));
  return (
    <div
      aria-label="Agent sessions"
      className="mb-2 overflow-hidden rounded-lg border border-edge bg-surface p-1.5 text-sm shadow-lg"
    >
      <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">Mention an agent</p>
      {matches.map((s, index) => (
        <button
          key={s.id}
          type="button"
          aria-label={`Mention ${s.name} (${s.harness})`}
          className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors ${index === active ? "bg-accent-soft" : "hover:bg-bg"}`}
          onMouseEnter={() => setActive(index)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => choose(s)}
        >
          <span aria-hidden="true" style={{color:REMOTE_COLOR_CSS[s.color??remoteColor(s.id)]}} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft font-semibold text-accent">@</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-fg">{s.name}</span>
            <span className="block truncate text-xs text-muted">{agentLabel(s.harness)} · {s.machine}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted"><span className="h-1.5 w-1.5 rounded-full bg-green-500" />{s.online?(s.activity??'Online'):'Offline'}</span>
        </button>
      ))}
      {!matches.length && (
        <div className="px-2 py-1.5 text-muted">
          <p>{loaded ? "No matching online sessions." : "Loading sessions…"}</p>
          {loaded && <>
            <p className="mt-2">Ask your agent to connect:</p>
            <div className="mt-2 flex items-start gap-2 rounded-md border border-edge bg-bg p-2">
              <p className="min-w-0 flex-1 text-xs text-fg">{connectionRequest}</p>
              <Tooltip content={copyState === 'copied' ? 'Copied' : 'Copy request'}>
                <button type="button" aria-label="Copy connection request"
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => void copyRequest()}
                  className="shrink-0 cursor-pointer rounded-md p-1 text-muted hover:text-fg">
                  {copyState === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                </button>
              </Tooltip>
            </div>
            <p role="status" className="mt-1 text-xs">{copyState === 'copied' ? 'Copied — paste into your agent.' : copyState === 'error' ? 'Could not copy. Select and copy the request above.' : ''}</p>
          </>}
        </div>
      )}
    </div>
  );
});
