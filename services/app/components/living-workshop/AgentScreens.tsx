import { ClaudeCodeIcon, CodexIcon } from "@/components/brand-icons";
/** Existing app marks, registered to the robot screens. Pi's path is from
 * https://pi.dev/logo-auto.svg; its white treatment belongs to the dark screen.
 */
export default function AgentScreens() {
  return (
    <div className="workshop-agent-screens">
      <span
        className="workshop-agent workshop-agent-claude"
        role="img"
        aria-label="Claude Code robot"
      >
        <ClaudeCodeIcon size={24} />
      </span>
      <span
        className="workshop-agent workshop-agent-codex"
        role="img"
        aria-label="Codex robot"
      >
        <CodexIcon size={24} />
      </span>
      <span
        className="workshop-agent workshop-agent-pi"
        role="img"
        aria-label="pi robot"
      >
        <svg viewBox="150 150 500 500" aria-hidden="true" fill="#fff4d9">
          <path
            fillRule="evenodd"
            d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
          />
          <path d="M517.36 400H634.72V634.72H517.36Z" />
        </svg>
      </span>
    </div>
  );
}
