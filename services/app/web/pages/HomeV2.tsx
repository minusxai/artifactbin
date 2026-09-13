import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUpRight, Check, Copy, RotateCcw } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import AgentScreens from "@/components/living-workshop/AgentScreens";
import LandingFaq from "@/components/LandingFaq";
import { REASONS, artSrc } from "@/lib/landing-content";
import { REPO_URL } from "@/lib/repo";
import {
  createWorkshopScene,
  type WorkshopScene,
} from "@/components/living-workshop/workshop-renderer";
import {
  WORKSHOP_SETTINGS,
  WORKSHOP_PAPERS,
  type WorkshopPaper,
  type WorkshopSetting,
} from "@/components/living-workshop/scene-manifest";
import "./home-v2.css";

/** Standalone review route: the workshop owns its chrome, not the app shell.
 * Canvas is visual enhancement; installation and all destinations stay in HTML.
 */
export default function HomeV2({
  environment = "indoor",
}: {
  environment?: WorkshopSetting["name"];
}) {
  const setting = WORKSHOP_SETTINGS[environment];
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<WorkshopScene | null>(null);
  const [reveal, setReveal] = useState<WorkshopPaper | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [promptState, setPromptState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [origin, setOrigin] = useState("https://artifactbin.dev");
  const [feature, setFeature] = useState(1);
  const [sceneReady, setSceneReady] = useState(false);
  const reason = REASONS[feature];
  // Same deployment-aware command as GetStarted; no document-specific agent
  // endpoint or account credentials belong in logged-out onboarding.
  const command = `curl -fsSL ${origin}/chat/install.sh | sh`;
  useEffect(() => {
    setOrigin(window.location.origin);
    const oldTitle = document.title;
    document.title = "Pull up a chair. — artifactbin";
    if (canvas.current) {
      try {
        scene.current = createWorkshopScene(
          canvas.current,
          WORKSHOP_PAPERS,
          setReveal,
          setting,
        );
        setSceneReady(!!scene.current);
      } catch {
        setSceneReady(false);
      }
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
      document.title = oldTitle;
    };
  }, [setting]);
  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(
        `Create an artifact with artifactbin. Use the installed afbin skill and CLI to build, validate, and publish it. If afbin is not installed, follow ${origin}/docs-human. Ask me what I want to make.`,
      );
      setPromptState("copied");
    } catch {
      setPromptState("error");
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };
  const revealPaper = (paper: WorkshopPaper) => {
    if (scene.current) scene.current.detach(paper.id);
    else setReveal(paper);
    canvas.current?.scrollIntoView?.({ block: "center" });
  };
  return (
    <main className="workshop-page" data-setting={environment}>
      <section className="workshop-hero" aria-label="The artifactbin workshop">
        <header className="workshop-nav">
          <a
            href="/"
            className="workshop-wordmark"
            aria-label="artifactbin home"
          >
            artifactbin
          </a>
          <nav aria-label="Main navigation">
            <a href="#workshop-examples">Examples</a>
            <a href="/docs-human">Docs</a>
            <a href="/login">
              Sign in <ArrowUpRight size={13} />
            </a>
          </nav>
        </header>
        <div className="workshop-intro">
          <h1>
            Pull up a chair.
            <br />
            Make something.
          </h1>
          <div className="workshop-install" id="workshop-install">
            <span className="workshop-label">Install artifactbin</span>
            <div className="workshop-command">
              <code>{command}</code>
              <Tooltip
                content={
                  copyState === "copied" ? "Copied!" : "Copy install command"
                }
              >
                <button
                  type="button"
                  onClick={() => void copy()}
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
            <div className="workshop-install-actions">
              <Tooltip content="Copy instructions for your agent">
                <button
                  type="button"
                  aria-label="Copy instructions to create an artifact"
                  onClick={() => void copyPrompt()}
                >
                  {promptState === "copied" ? (
                    <Check size={15} />
                  ) : (
                    <Copy size={15} />
                  )}
                  {promptState === "copied"
                    ? "Instructions copied"
                    : "Create an artifact"}
                </button>
              </Tooltip>
              <a href="/docs-human">
                How it works <ArrowUpRight size={13} />
              </a>
            </div>
            <p role="status" className="workshop-copy-status">
              {promptState === "copied"
                ? "Paste the instructions into your agent."
                : promptState === "error"
                  ? "Could not copy. Try again."
                  : copyState === "copied"
                    ? "Copied — paste into your terminal"
                    : copyState === "error"
                      ? "Select and copy the command above."
                      : "Works with Claude Code, Codex, pi, and your next favorite agent."}
            </p>
          </div>
        </div>
        <div className="workshop-picture">
          <div className="workshop-scene-frame">
            <img
              src={setting.image}
              alt="A sunlit artist’s workshop with green plants, a woman at a cork board, and small robot helpers."
              className="workshop-scene-fallback"
              fetchPriority="high"
              width={1920}
              height={1440}
            />
            <AgentScreens />
            <canvas
              ref={canvas}
              className="workshop-canvas"
              aria-hidden="true"
            />
          </div>
        </div>
        <div className="workshop-scene-controls">
          <p>
            {sceneReady
              ? "Pick a page. Pull a corner. See what’s underneath."
              : "Explore the real examples below."}
          </p>
          <button
            type="button"
            onClick={() => {
              scene.current?.reset();
              setReveal(null);
            }}
          >
            <RotateCcw size={13} /> Reset board
          </button>
        </div>
        <div className="workshop-reveal" role="status" aria-live="polite">
          {reveal && (
            <>
              <span>{reveal.reveal}</span>
              <a href={reveal.href}>
                Open the artifact <ArrowUpRight size={14} />
              </a>
            </>
          )}
        </div>
      </section>
      <section
        id="workshop-examples"
        className="workshop-examples"
        aria-labelledby="workshop-examples-title"
      >
        <div className="workshop-section-heading">
          <h2 id="workshop-examples-title">Made here. Open something.</h2>
          <p>
            Real work, made with real agents. <ArrowDown size={14} />
          </p>
        </div>
        <div className="workshop-example-rail">
          {WORKSHOP_PAPERS.map((paper) => (
            <article className="workshop-example" key={paper.id}>
              <a href={paper.href} aria-label={paper.title}>
                <div className="workshop-example-preview">
                  <img src={paper.image} alt="" loading="lazy" />
                </div>
                <span className="workshop-label">{paper.kind}</span>
                <h3>
                  {paper.title} <ArrowUpRight size={13} />
                </h3>
              </a>
              <button
                type="button"
                aria-label={`Reveal behind ${paper.title}`}
                onClick={() => revealPaper(paper)}
              >
                Peek underneath ↗
              </button>
            </article>
          ))}
        </div>
      </section>
      <section
        className="workshop-features"
        aria-labelledby="workshop-features-title"
      >
        <div className="workshop-feature-copy">
          <span className="workshop-label">The part after “generate”</span>
          <h2 id="workshop-features-title">Make it yours.</h2>
          <div
            className="workshop-feature-tabs"
            role="group"
            aria-label="Explore capabilities"
          >
            {[
              { label: "Edit", index: 1 },
              { label: "Collaborate", index: 2 },
              { label: "Explore data", index: 3 },
            ].map((item) => (
              <button
                key={item.index}
                type="button"
                aria-pressed={feature === item.index}
                onClick={() => setFeature(item.index)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <h3>{reason.title}</h3>
          <p>{reason.body}</p>
          <a href="/docs-human">
            See how it works <ArrowUpRight size={15} />
          </a>
        </div>
        <img
          key={reason.image}
          className="workshop-feature-art"
          src={artSrc(reason.image, "water", 760)}
          alt={reason.alt}
          loading="lazy"
          width={760}
          height={760}
        />
      </section>
      <LandingFaq column="workshop-faq" />
      <footer className="workshop-footer">
        <a href="/" className="workshop-wordmark">
          artifactbin
        </a>
        <p>A place for the things you make.</p>
        <nav aria-label="Footer">
          <a href={REPO_URL}>Open source ↗</a>
          <a href="/docs-human">Docs</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
      </footer>
    </main>
  );
}
