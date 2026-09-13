import { ClaudeCodeIcon, CodexIcon } from "@/components/brand-icons";

/** Enlarge the painted monitor housing itself, with the agent mark seated in
 * its screen. The source-image crop preserves the ceramic case and perspective. */
export default function AgentScreens({ image }: { image: string }) {
  return (
    <div className="workshop-agent-screens">
      <svg
        className="workshop-agent workshop-agent-claude"
        viewBox="550 435 74 60"
        role="img"
        aria-label="Claude Code robot"
      >
        <defs>
          <clipPath id="workshop-claude-head">
            <path d="M555 459 Q553 453 561 449 L595 438 Q606 435 611 446 L618 473 Q617 480 608 483 L576 491 Q565 493 562 483Z" />
          </clipPath>
        </defs>
        <image
          href={image}
          width="1448"
          height="1086"
          clipPath="url(#workshop-claude-head)"
        />
        <g transform="translate(586 447) rotate(-16)">
          <rect width="24" height="30" rx="4" fill="#101815" />
          <svg x="1" y="3" width="22" height="24" viewBox="0 0 24 24">
            <ClaudeCodeIcon size={24} />
          </svg>
        </g>
      </svg>
      <svg
        className="workshop-agent workshop-agent-codex"
        viewBox="463 632 67 54"
        role="img"
        aria-label="Codex robot"
      >
        <defs>
          <clipPath id="workshop-codex-head">
            <path d="M469 646 Q470 638 482 638 L507 636 Q521 635 524 647 L525 666 Q525 676 515 678 L480 680 Q468 678 468 668Z" />
          </clipPath>
        </defs>
        <image
          href={image}
          width="1448"
          height="1086"
          clipPath="url(#workshop-codex-head)"
        />
        <g transform="translate(499 643) rotate(-2)">
          <rect width="22" height="30" rx="4" fill="#101815" />
          <svg x="0" y="3" width="22" height="23" viewBox="0 0 24 24">
            <CodexIcon size={24} />
          </svg>
        </g>
      </svg>
      <svg
        className="workshop-agent workshop-agent-pi"
        viewBox="960 697 70 57"
        role="img"
        aria-label="pi robot"
      >
        <defs>
          <clipPath id="workshop-pi-head">
            <path d="M968 715 Q963 707 974 704 L1005 700 Q1018 698 1021 708 L1028 733 Q1029 742 1019 745 L984 750 Q974 751 972 742Z" />
          </clipPath>
        </defs>
        <image
          href={image}
          width="1448"
          height="1086"
          clipPath="url(#workshop-pi-head)"
        />
        <g transform="translate(996 708) rotate(-13)">
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
