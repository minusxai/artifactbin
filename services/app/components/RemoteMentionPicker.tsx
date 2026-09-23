import {remoteMention} from '../lib/remote-reply';
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Check, Copy, X } from "lucide-react";
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
  const [setupExpanded, setSetupExpanded] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const remove = async (id: string) => {
    setRemoving(id); setError('');
    try {
      const response = await fetch(`/api/remote/sessions/${id}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? 'Could not remove agent. Try again.');
      }
      setSessions(items => items.filter(item => item.id !== id));
      setActive(0);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not remove agent. Try again.'); }
    finally { setRemoving(null); }
  };
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
  const choose = (s: RemoteSessionInfo) => onSelect(remoteMention(s));
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
        <div key={s.id} className="flex items-center">
        <button
          type="button"
          aria-label={`Mention ${s.name} (${s.harness})`}
          className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors ${index === active ? "bg-accent-soft" : "hover:bg-bg"}`}
          onMouseEnter={() => setActive(index)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => choose(s)}
        >
          <span aria-hidden="true" style={{color:REMOTE_COLOR_CSS[s.color??remoteColor(s.id)]}} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft font-semibold text-accent">@</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-fg">{s.name}</span>
            <span className="block truncate text-xs text-muted">{agentLabel(s.harness)} · {s.machine}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted"><span className={`h-1.5 w-1.5 rounded-full ${s.online ? "bg-green-500" : "bg-muted"}`} />{s.online?(s.activity??'Online'):'Offline'}</span>
        </button>
        {!s.online && <Tooltip content="Remove agent">
          <button type="button" aria-label={`Remove ${s.name}`} disabled={removing !== null}
            className="rounded-md p-2 text-muted hover:text-fg disabled:opacity-40"
            onMouseDown={event => event.preventDefault()} onClick={() => void remove(s.id)}>
            <X size={14} aria-hidden="true" />
          </button>
        </Tooltip>}
        </div>
      ))}
      {error && <p role="alert" className="px-2 py-1.5 text-sm text-muted">{error}</p>}
      {loaded && matches.length > 0 && <button type="button" aria-expanded={setupExpanded}
        className="w-full rounded-md px-2 py-2 text-left text-xs text-muted hover:text-fg"
        onMouseDown={event => event.preventDefault()} onClick={() => setSetupExpanded(value => !value)}>
        Add another agent
      </button>}
      {(!matches.length || setupExpanded) && (
        <div className="px-2 py-1.5 text-muted">
          {!matches.length && <p>{loaded ? "No matching agents." : "Loading sessions…"}</p>}
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
