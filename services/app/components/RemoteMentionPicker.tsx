import { useEffect, useState } from "react";
import type { RemoteSessionInfo } from "../../contracts/src/remote";
export default function RemoteMentionPicker({
  query,
  onSelect,
}: {
  query: string;
  onSelect: (text: string) => void;
}) {
  const [sessions, setSessions] = useState<RemoteSessionInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
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
      s.online &&
      `${s.name} ${s.harness}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div
      aria-label="Agent sessions"
      className="mb-2 rounded border border-edge bg-surface p-2 text-sm"
    >
      {matches.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-label={`Mention ${s.name} (${s.harness})`}
          className="block w-full rounded px-2 py-2 text-left hover:bg-bg"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            onSelect(
              `[@${s.name.replace(/[\[\]\\\n]/g, "")}](/chat?session=${s.id}) `,
            )
          }
        >
          @{s.name}{" "}
          <span className="text-muted">
            {s.harness} · {s.machine}
          </span>
        </button>
      ))}
      {!matches.length && (
        <p className="text-muted">
          {loaded
            ? "No matching online sessions. Start one with afbin remote."
            : "Loading sessions…"}
        </p>
      )}
    </div>
  );
}
