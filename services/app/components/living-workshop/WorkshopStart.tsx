import { useState } from "react";
import { ArrowUpRight, Check, Copy } from "lucide-react";
import { ClaudeCodeIcon, CodexIcon, PiIcon } from "@/components/brand-icons";
import { Tooltip } from "@/components/Tooltip";

/**
 * THE TWO STEPS, AS TEXT AND ONE BUTTON.
 *
 * The same claims the deployed landing makes in its get-started panel —
 * verified installer, agent sign-in, the harnesses it teaches — but as short
 * notes under each step rather than a panel: the painted room beside them is
 * the frame. Copy state lives here because it is the only interactive thing.
 */
type CopyState = "idle" | "copied" | "error";
/** The harnesses the installer actually teaches, with the marks they ship under. */
const AGENTS = [
  { name: "Claude Code", mark: <ClaudeCodeIcon size={13} /> },
  { name: "Codex", mark: <CodexIcon size={13} /> },
  { name: "pi", mark: <PiIcon size={13} /> },
  { name: "OpenCode", mark: null },
];

export default function WorkshopStart({ origin }: { origin: string }) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [promptState, setPromptState] = useState<CopyState>("idle");
  // Same deployment-aware command as GetStarted; no document-specific agent
  // endpoint or account credentials belong in logged-out onboarding.
  const command = `curl -fsSL ${origin}/chat/install.sh | sh`;
  const write = async (text: string, set: (state: CopyState) => void) => {
    try {
      await navigator.clipboard.writeText(text);
      set("copied");
    } catch {
      set("error");
    }
  };
  const status =
    promptState === "copied"
      ? "Paste the instructions into your agent."
      : promptState === "error"
        ? "Could not copy. Try again."
        : copyState === "copied"
          ? "Copied — paste into your terminal"
          : copyState === "error"
            ? "Select and copy the command above."
            : "";
  return (
    <div className="workshop-start" id="workshop-install">
      <ol className="workshop-steps">
        <li>
          <div>
            <span className="workshop-label">1. Install the CLI</span>
            <div className="workshop-command">
              <code>{command}</code>
              <Tooltip
                content={
                  copyState === "copied" ? "Copied!" : "Copy install command"
                }
              >
                <button
                  type="button"
                  onClick={() => void write(command, setCopyState)}
                  aria-label="Copy install command"
                >
                  {copyState === "copied" ? (
                    <Check size={15} />
                  ) : (
                    <Copy size={15} />
                  )}
                </button>
              </Tooltip>
            </div>
          </div>
        </li>
        <li>
          <div>
            <span className="workshop-label">2. Create with your agent</span>
            <div className="workshop-install-actions">
              <Tooltip content="Copy instructions for your agent">
                <button
                  type="button"
                  aria-label="Copy instructions to create an artifact"
                  onClick={() =>
                    void write(
                      `Create an artifact with artifactbin. Use the installed afbin skill and CLI to build, validate, and publish it. If afbin is not installed, follow ${origin}/docs-human. Ask me what I want to make.`,
                      setPromptState,
                    )
                  }
                >
                  {promptState === "copied" ? (
                    <Check size={15} />
                  ) : (
                    <Copy size={15} />
                  )}
                  {promptState === "copied"
                    ? "Instructions copied"
                    : "Copy instructions"}
                </button>
              </Tooltip>
              <a href="/docs-human">
                How it works <ArrowUpRight size={13} />
              </a>
            </div>
          </div>
        </li>
      </ol>
      <p role="status" className="workshop-copy-status">
        {status}
      </p>
      <ul className="workshop-agent-row" aria-label="Agents this installs for">
        {AGENTS.map((agent) => (
          <li key={agent.name}>
            {agent.mark}
            {agent.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
