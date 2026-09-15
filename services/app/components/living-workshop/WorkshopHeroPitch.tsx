import { useEffect, useState } from "react";
import { Check, Copy, FilePlus2 } from "lucide-react";
import { ClaudeCodeIcon, CodexIcon, PiIcon, OpenCodeIcon, GitHubIcon } from "@/components/brand-icons";
import { REPO_URL } from "@/lib/repo";
import { Tooltip } from "@/components/Tooltip";

/** Homepage introduction and agent setup actions. */
export default function WorkshopHeroPitch({ origin }: {
  origin: string;
}) {
  const [status, setStatus] = useState("");
  const [commandStatus, setCommandStatus] = useState("");
  const command = `curl -fsSL ${origin}/chat/install.sh | bash`;
  useEffect(() => {
    if (commandStatus !== "Copied") return;
    const timer = window.setTimeout(() => setCommandStatus(""), 2000);
    return () => window.clearTimeout(timer);
  }, [commandStatus]);
  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCommandStatus("Copied");
    } catch {
      setCommandStatus("Couldn't copy. Select and copy the command above.");
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Help me create an artifact with artifactbin. Read ${origin}/docs-human for setup, then ask me what I want to make.`);
      setStatus("Copied. Paste into your agent.");
    } catch {
      setStatus("Couldn't copy. Open the setup guide below.");
    }
  };
  return (
    <div className="workshop-pitch">
      <h1>Make something.<br /><em>Together.</em></h1>
      <p>Create <span className="workshop-pitch-accent">interactive HTML documents</span> that you can <span className="workshop-pitch-accent">edit</span>, <span className="workshop-pitch-accent">share</span> and <span className="workshop-pitch-accent">collaborate</span> on. With a little help from your <span className="workshop-pitch-accent">band of agents</span>.</p>
      <div className="workshop-pitch-command">
        <code>{command}</code>
        <Tooltip content={commandStatus === "Copied" ? "Copied!" : "Copy install command"}>
          <button type="button" className="workshop-command-copy" aria-label="Copy install command" onClick={() => void copyCommand()}>
            {commandStatus === "Copied" ? <Check size={15} /> : <Copy size={15} />}
          </button>
        </Tooltip>
      </div>
      <span role="status" className={commandStatus.startsWith("Couldn't") ? "workshop-pitch-status" : "sr-only"}>{commandStatus}</span>
      <div className="workshop-pitch-actions">
        <button type="button" onClick={() => void copy()} aria-label="Create Artifact — copy agent instructions"><span className="workshop-pitch-create-label"><FilePlus2 size={16} strokeWidth={1.5} />Create Artifact</span><span className="workshop-pitch-button-hint">{status.startsWith("Copied") ? <Check size={14} /> : <Copy size={14} />}{status.startsWith("Copied") ? "instructions copied" : "copy agent instructions"}</span></button>
      </div>
      {status && <p className="workshop-pitch-status" role="status">{status} <a href="/docs-human">Setup guide ↗</a></p>}
      <div className="workshop-agent-support">
      <ul className="workshop-agent-row" aria-label="Works with">
        <li>Works with</li>
        <li><ClaudeCodeIcon size={13} />Claude Code</li>
        <li><CodexIcon size={13} />Codex</li>
        <li><PiIcon size={13} />pi</li>
        <li><OpenCodeIcon size={13} />OpenCode</li>
      </ul>
      <a className="workshop-open-source" href={REPO_URL} target="_blank" rel="noopener noreferrer"><GitHubIcon size={14} /><span>Open source · Apache 2.0</span></a>
      </div>
    </div>
  );
}
