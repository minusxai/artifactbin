import {personMention} from '../lib/person-mentions';
import {remoteMention} from '../lib/remote-reply';
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Check, ChevronDown, Copy, Plus, X } from "lucide-react";
import { Tooltip } from "./Tooltip";
import {REMOTE_COLOR_CSS,remoteColor,type RemoteSessionInfo } from "../../contracts/src/remote";
import { useArtifactBackend } from "@/lib/artifact-backend/context";
import type { MemberPerson } from "@/lib/artifact-backend/types";
const connectionRequest = "Connect to afbin remote so I can @mention you in artifact comments.";
export interface MentionPickerHandle { keyDown: (key: string) => boolean }
const agentLabel = (name: string) => (({ claude: "Claude Code", codex: "Codex", pi: "Pi", opencode: "OpenCode" } as Record<string, string>)[name] ?? name);
export default forwardRef<MentionPickerHandle, { query: string; artifactId?:string; onSelect: (text: string) => void }>(function RemoteMentionPicker({
  query, artifactId,
  onSelect,
}: {
  query: string;
  artifactId?:string;
  onSelect: (text: string) => void;
}, ref) {
  const backend = useArtifactBackend();
  /** People and agents are both looked up on the server; without either, its section says why. */
  const peopleUnavailable = backend.unavailable('mentions');
  const sessionsUnavailable = backend.unavailable('remoteSessions');
  const [people,setPeople]=useState<MemberPerson[]>([]);
  useEffect(()=>{if(!artifactId||peopleUnavailable)return;const abort=new AbortController();void backend.members(query,{signal:abort.signal}).then(r=>r??{people:[]}).then(r=>setPeople(r.people??[])).catch(()=>{});return()=>abort.abort();},[artifactId,query,backend,peopleUnavailable]);
  const [sessions, setSessions] = useState<RemoteSessionInfo[]>([]);
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [query]);
  const [setupExpanded, setSetupExpanded] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const remove = async (id: string) => {
    setRemoving(id); setError('');
    try {
      await backend.deleteRemoteSession(id);
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
    if (sessionsUnavailable) return;
    const abort = new AbortController();
    void backend.remoteSessions({ signal: abort.signal })
      .then((data) => {
        setSessions(data.sessions as RemoteSessionInfo[]);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => abort.abort();
  }, [backend, sessionsUnavailable]);
  const matches = sessions.filter(
    (s) =>
      (s.managed?s.exitCode===null&&s.activity!=='stopped':s.online) &&
      `${s.name} ${s.harness}`.toLowerCase().includes(query.toLowerCase()),
  );
  const choose = (s: RemoteSessionInfo) => onSelect(remoteMention(s));
  useImperativeHandle(ref, () => ({ keyDown(key) {
    const count=people.length+matches.length;
    if (!count) return false;
    if (key === "ArrowDown" || key === "ArrowUp") {
      setActive(i => (i + (key === "ArrowDown" ? 1 : count - 1)) % count);
      return true;
    }
    if (key === "Enter" || key === "Tab") { const index=active%count;if(index<people.length)onSelect(personMention(people[index]));else choose(matches[index-people.length]); return true; }
    return false;
  }}));
  return (
    <div
      aria-label="Agent sessions"
      className="mb-2 overflow-hidden rounded-lg border border-edge bg-surface p-1.5 text-sm shadow-lg"
    >
      {artifactId&&<><p className="px-2 py-1.5 text-xs text-muted">Mention a person</p>{people.map((p,i)=><button key={p.user_id} type="button" aria-label={`Mention @${p.username}`} className={`block w-full rounded-md px-2 py-2 text-left ${i===active?'bg-accent-soft':'hover:bg-bg'}`} onMouseDown={e=>e.preventDefault()} onMouseEnter={()=>setActive(i)} onClick={()=>onSelect(personMention(p))}>@{p.username}<span className="ml-2 text-xs text-muted">{p.name}</span></button>)}{peopleUnavailable?<p role="note" className="px-2 py-1 text-xs text-muted">{peopleUnavailable}</p>:!people.length&&<p className="px-2 py-1 text-xs text-muted">No matching followers or members.</p>}</>}
      <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">Mention an agent</p>
      {matches.map((s, index) => (
        <div key={s.id} className="flex items-center">
        <button
          type="button"
          aria-label={`Mention ${s.name} (${s.harness})`}
          className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors ${index+people.length === active ? "bg-accent-soft" : "hover:bg-bg"}`}
          onMouseEnter={() => setActive(index+people.length)}
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
        className="mt-1 flex w-full cursor-pointer items-center gap-2 rounded-md border border-edge bg-bg px-2 py-2 text-left text-xs font-medium text-fg transition-colors hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onMouseDown={event => event.preventDefault()} onClick={() => setSetupExpanded(value => !value)}>
        <Plus size={14} aria-hidden="true" />
        Add another agent
        <ChevronDown size={14} aria-hidden="true" className={`ml-auto transition-transform ${setupExpanded ? "rotate-180" : ""}`} />
      </button>}
      {sessionsUnavailable && <p role="note" className="px-2 py-1.5 text-xs text-muted">{sessionsUnavailable}</p>}
      {!sessionsUnavailable && (!matches.length || setupExpanded) && (
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
