import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Pause, Play, RotateCcw } from "lucide-react";
import { ClaudeCodeIcon, CodexIcon, PiIcon } from "@/components/brand-icons";
import {
  createRobotPreview,
  type RobotAgent,
} from "@/components/living-workshop/robot-preview";
import "./workshop-robots.css";

const AGENTS = [
  { key: "claude", label: "Claude Code", Icon: ClaudeCodeIcon },
  { key: "codex", label: "Codex", Icon: CodexIcon },
  { key: "pi", label: "pi", Icon: PiIcon },
] as const;
export default function WorkshopRobots() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<ReturnType<typeof createRobotPreview> | null>(null);
  const [agent, setAgent] = useState<RobotAgent>("claude");
  const [status, setStatus] = useState("Loading the helpers…");
  const [playing, setPlaying] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const oldTitle = document.title;
    document.title = "Meet the workshop helpers — artifactbin";
    if (!canvas.current) return;
    try {
      viewer.current = createRobotPreview(
        canvas.current,
        () => setStatus("Drag to look around. Scroll to get closer."),
        () =>
          setStatus(
            "The 3D preview could not load. The rendered preview and model downloads are below.",
          ),
      );
    } catch {
      setStatus(
        "WebGL is unavailable. The rendered preview and model downloads are below.",
      );
    }
    return () => {
      viewer.current?.dispose();
      viewer.current = null;
      document.title = oldTitle;
    };
  }, []);
  return (
    <main className="robot-review">
      <nav>
        <a href="/home_v2">
          <ArrowLeft size={16} /> Back to the workshop
        </a>
        <a href="/" className="robot-review-brand">
          <img src="/logo-128.png" alt="" />
          artifactbin
        </a>
      </nav>
      <header>
        <span>THE WORKSHOP HELPERS / FIRST SCULPT</span>
        <h1>
          A little more <em>alive.</em>
        </h1>
        <p>Warm ivory. Cobalt joints. A face with a little personality.</p>
      </header>
      <div className="robot-review-stage">
        <canvas
          ref={canvas}
          aria-label="Animated ivory robot with a chest badge and an articulated painting arm"
        />
      </div>
      <div className="robot-review-controls">
        <div role="group" aria-label="Robot chest badge">
          {AGENTS.map(({ key, label, Icon }) => (
            <button
              key={key}
              aria-pressed={agent === key}
              onClick={() => {
                setAgent(key);
                viewer.current?.setAgent(key);
              }}
            >
              <Icon size={20} />
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => {
            viewer.current?.setPlaying(!playing);
            setPlaying(!playing);
          }}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}{" "}
          {playing ? "Pause motion" : "Play motion"}
        </button>
        <button onClick={() => viewer.current?.resetView()}>
          <RotateCcw size={16} /> Reset view
        </button>
      </div>
      <p className="robot-review-status" role="status">
        {status}
      </p>
      <section className="robot-review-notes">
        <div>
          <h2>One friendly helper.</h2>
          <p>
            Two blinking oval eyes, a gentle head turn and a quiet standing
            pose. The agent mark lives on the chest.
          </p>
          <a href="/landing/workshop/robots/workshop-bot.glb" download>
            Download robot GLB <ArrowUpRight size={15} />
          </a>
        </div>
        <div>
          <h2>One steady hand.</h2>
          <p>
            An articulated shoulder, elbow and wrist, with a real gripper
            holding a paintbrush.
          </p>
          <a href="/landing/workshop/robots/workshop-arm.glb" download>
            Download arm GLB <ArrowUpRight size={15} />
          </a>
        </div>
      </section>
      <details>
        <summary>View the Blender render</summary>
        <img
          className="robot-beauty-render"
          src="/landing/workshop/robots/workshop-helpers.png"
          alt="Blender studio render of the two ivory and cobalt workshop helpers"
          loading="lazy"
        />
      </details>
    </main>
  );
}
