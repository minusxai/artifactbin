import type { ReactElement } from "react";
import { ClaudeCodeIcon, CodexIcon, PiIcon } from "@/components/brand-icons";

/**
 * WHICH ROBOT RUNS WHICH AGENT, drawn over the painting in source-image
 * coordinates. The painted heads stay untouched; only the dark screens are
 * covered, and the mark sits inset on each one, lit like a display, rather
 * than filling it edge to edge as a face would.
 */
interface Robot {
  label: string;
  className: string;
  /** Top-left of the screen, its tilt, and whether it must be painted dark first. */
  screen: { x: number; y: number; angle: number; scale: number; w: number; dark: boolean };
  Mark: (props: { size?: number }) => ReactElement;
  ink: string;
}
const ROBOTS: Robot[] = [
  {
    label: "Claude Code robot",
    className: "workshop-agent-claude",
    screen: { x: 590, y: 449, angle: -16, scale: 0.8, w: 24, dark: true },
    Mark: ClaudeCodeIcon,
    ink: "#D97757",
  },
  {
    label: "Codex robot",
    className: "workshop-agent-codex",
    screen: { x: 500, y: 645, angle: -2, scale: 0.87, w: 22, dark: true },
    Mark: CodexIcon,
    ink: "#7A9DFF",
  },
  {
    label: "pi robot",
    className: "workshop-agent-pi",
    screen: { x: 999, y: 712, angle: -13, scale: 0.8, w: 22, dark: false },
    Mark: PiIcon,
    ink: "#fff4d9",
  },
];
const SCREEN_H = 30;

function Screen({ robot }: { robot: Robot }) {
  const { screen, Mark, ink } = robot;
  const mark = screen.w * 0.6;
  return (
    <g
      transform={`translate(${screen.x} ${screen.y}) rotate(${screen.angle}) scale(${screen.scale})`}
      color="#fff4d9"
    >
      {screen.dark && <rect width={screen.w} height={SCREEN_H} rx="4" fill="#101815" />}
      <ellipse
        cx={screen.w / 2}
        cy={SCREEN_H / 2}
        rx={screen.w * 0.42}
        ry={SCREEN_H * 0.3}
        fill={ink}
        opacity="0.16"
      />
      <svg
        x={(screen.w - mark) / 2}
        y={(SCREEN_H - mark) / 2}
        width={mark}
        height={mark}
        viewBox="0 0 24 24"
      >
        <Mark size={24} />
      </svg>
    </g>
  );
}

export default function AgentScreens({ inCanvas = false }: { inCanvas?: boolean }) {
  return (
    <div className="workshop-agent-screens" data-canvas={inCanvas}>
      {ROBOTS.map((robot) => (
        <svg
          key={robot.className}
          className={`workshop-agent ${robot.className}`}
          viewBox="0 0 1448 1086"
          role="img"
          aria-label={robot.label}
        >
          <Screen robot={robot} />
        </svg>
      ))}
    </div>
  );
}
