import { ClaudeCodeIcon, CodexIcon } from "@/components/brand-icons";

/** Screen-only overlays in source-image coordinates. The painted heads stay untouched. */
export default function AgentScreens() {
  return (
    <div className="workshop-agent-screens">
      <svg
        className="workshop-agent workshop-agent-claude"
        viewBox="0 0 1448 1086"
        role="img"
        aria-label="Claude Code robot"
      >
        <g transform="translate(590 449) rotate(-16) scale(.8)">
          <rect width="24" height="30" rx="4" fill="#101815" />
          <svg x="1" y="3" width="22" height="24" viewBox="0 0 24 24">
            <ClaudeCodeIcon size={24} />
          </svg>
        </g>
      </svg>
      <svg
        className="workshop-agent workshop-agent-codex"
        viewBox="0 0 1448 1086"
        role="img"
        aria-label="Codex robot"
      >
        <g transform="translate(500 645) rotate(-2) scale(.87)">
          <rect width="22" height="30" rx="4" fill="#101815" />
          <svg x="0" y="3" width="22" height="23" viewBox="0 0 24 24">
            <CodexIcon size={24} />
          </svg>
        </g>
      </svg>
      <svg
        className="workshop-agent workshop-agent-pi"
        viewBox="0 0 1448 1086"
        role="img"
        aria-label="pi robot"
      >
        <g transform="translate(999 712) rotate(-13) scale(.8)">
          <rect width="23" height="30" rx="4" fill="#101815" />
          <svg
            x="2"
            y="4"
            width="19"
            height="22"
            viewBox="150 150 500 500"
            fill="#fff4d9"
          >
            <path
              fillRule="evenodd"
              d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
            />
            <path d="M517.36 400H634.72V634.72H517.36Z" />
          </svg>
        </g>
      </svg>
    </div>
  );
}
