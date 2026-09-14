import { useState } from "react";
import { Check, Copy, FilePlus2 } from "lucide-react";
import { ClaudeCodeIcon, CodexIcon, PiIcon, OpenCodeIcon } from "@/components/brand-icons";

/** Temporary hero comparison: one promise, one action, optional installation. */
export default function WorkshopHeroPitch({ variant, origin }: {
  variant: "minimal" | "glass" | "paper";
  origin: string;
}) {
  const [status, setStatus] = useState("");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Help me create an artifact with artifactbin. Read ${origin}/docs-human for setup, then ask me what I want to make.`);
      setStatus("Copied. Paste into your agent.");
    } catch {
      setStatus("Couldn't copy. Open the setup guide below.");
    }
  };
  return (
    <div className={`workshop-pitch workshop-pitch-${variant}`}>
      <span className="workshop-pitch-eyebrow">You, your agents, your friends & their agents</span>
      <h1>{variant === "minimal" ? <>Make something.<br /><em>Together.</em></> : variant === "glass" ? <>From a thought.<br />To a thing.</> : <>Good ideas<br />live here.</>}</h1>
      <p>{variant === "minimal" ? "Create with your agents. Edit, share and collaborate." : variant === "glass" ? "Create with your agent. Edit, share, make it yours." : "Documents, dashboards, little wonders. Made together."}</p>
      <code className="workshop-pitch-command">{`curl -fsSL ${origin}/chat/install.sh | bash`}</code>
      <div className="workshop-pitch-actions">
        <button type="button" onClick={() => void copy()} aria-label="Create artifact — copy agent instructions"><span className="workshop-pitch-create-label"><FilePlus2 size={16} strokeWidth={1.5} />Create artifact</span><span className="workshop-pitch-button-hint">{status.startsWith("Copied") ? <Check size={14} /> : <Copy size={14} />}{status.startsWith("Copied") ? "instructions copied" : "copy agent instructions"}</span></button>
      </div>
      {status && <p className="workshop-pitch-status" role="status">{status} <a href="/docs-human">Setup guide ↗</a></p>}
      <ul className="workshop-agent-row" aria-label="Works with">
        <li>Works with</li>
        <li><ClaudeCodeIcon size={13} />Claude Code</li>
        <li><CodexIcon size={13} />Codex</li>
        <li><PiIcon size={13} />pi</li>
        <li><OpenCodeIcon size={13} />OpenCode</li>
      </ul>
    </div>
  );
}
