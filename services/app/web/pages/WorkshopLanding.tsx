import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, House, Trees, FilePlus2, Copy, Check } from "lucide-react";
import WorkshopHeroPitch from "@/components/living-workshop/WorkshopHeroPitch";
import LandingFaq from "@/components/LandingFaq";
import { REPO_URL } from "@/lib/repo";
import { type WorkshopScene } from "@/components/living-workshop/workshop-renderer";
import {
  WORKSHOP_SETTINGS,
  workshopImageSrcSet,
  WORKSHOP_PAPERS,
  type WorkshopPaper,
  type WorkshopSetting,
} from "@/components/living-workshop/scene-manifest";
import WorkshopNav from "@/components/living-workshop/WorkshopNav";
import { useWorkshopAppearance, setWorkshopAppearance } from "@/lib/workshop-appearance";
import WorkshopDirections from "@/components/living-workshop/WorkshopDirections";
import WorkshopComments from "@/components/living-workshop/WorkshopComments";

/** Public homepage: the workshop owns its chrome, not the app shell.
 * Canvas is visual enhancement; installation and all destinations stay in HTML.
 */
export default function WorkshopLanding({
  environment: override,
}: {
  environment?: WorkshopSetting["name"];
}) {
  const preference = useWorkshopAppearance();
  const environment = override ?? preference;
  const setting = WORKSHOP_SETTINGS[environment];
  const initialSetting = useRef(setting);
  initialSetting.current = setting;
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<WorkshopScene | null>(null);
  const [reveal, setReveal] = useState<WorkshopPaper | null>(null);
  const [origin, setOrigin] = useState("https://artifactbin.dev");
  const [footerStatus, setFooterStatus] = useState("");
  const copyFooterInstructions = async () => {
    try {
      await navigator.clipboard.writeText(`Help me create an artifact with artifactbin. Read ${origin}/docs-human for setup, then ask me what I want to make.`);
      setFooterStatus("Copied. Paste into your agent.");
    } catch {
      setFooterStatus("Couldn't copy. Open the setup guide.");
    }
  };
  useEffect(() => {
    setOrigin(window.location.origin);
    const oldTitle = document.title;
    document.title = "Artifactbin - Google docs for agents";
    let cancelled = false;
    // Keep Three.js and physics in a browser-only chunk; static landing HTML stays synchronous.
    void import("@/components/living-workshop/workshop-renderer").then(
      ({ createWorkshopScene }) => {
        if (cancelled || !canvas.current) return;
        try {
          scene.current = createWorkshopScene(
            canvas.current,
            WORKSHOP_PAPERS,
            setReveal,
            initialSetting.current,
          );
        } catch {
          // The HTML background remains available if WebGL cannot initialize.
        }
      },
    );
    return () => {
      cancelled = true;
      scene.current?.dispose();
      scene.current = null;
      document.title = oldTitle;
    };
  }, []);
  useEffect(() => {
    scene.current?.setSetting(setting);
  }, [setting]);
  return (
    <main className="workshop-page" data-setting={environment}>
      <WorkshopNav />
      <section className="workshop-hero workshop-option workshop-option-minimal" aria-label="The artifactbin workshop">
      {!override && <div className="workshop-scene-switch" role="group" aria-label="Workshop setting">
        {(["indoor", "outdoor"] as const).map((value) => (
          <button key={value} type="button" aria-pressed={environment === value} onClick={() => setWorkshopAppearance(value)}>
            {value === "indoor" ? <House size={13} strokeWidth={1.5} /> : <Trees size={13} strokeWidth={1.5} />}
            {value}
          </button>
        ))}
      </div>}
        <WorkshopHeroPitch variant="minimal" origin={origin} />
        <div className="workshop-picture">
          <div className="workshop-scene-frame">
            <img
              src={setting.fallbackImage ?? setting.image}
              srcSet={workshopImageSrcSet(environment)}
              sizes="100vw"
              alt="A sunlit artist’s workshop with green plants, a woman at a cork board, and small robot helpers."
              className="workshop-scene-fallback"
              fetchPriority="high"
              width={1672}
              height={941}
            />
            <canvas
              ref={canvas}
              className="workshop-canvas"
              aria-hidden="true"
            />
          </div>
        </div>
        <WorkshopComments />
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
      <WorkshopDirections />
      <LandingFaq column="workshop-faq" heading="FAQs." />
      <footer className="workshop-footer">
        <div className="workshop-footer-top">
          <div>
            <a
              href="/"
              className="workshop-wordmark"
              aria-label="artifactbin home"
            >
              <img src="/logo-128.png" alt="" width={64} height={64} />
              <span className="workshop-brand-text">
                <span>artifactbin</span>
                <span className="workshop-tagline">Google Docs for agents</span>
              </span>
            </a>
          </div>
          <div>
            <div className="workshop-pitch-actions">
              <button type="button" onClick={() => void copyFooterInstructions()} aria-label="Create Artifact — copy agent instructions">
                <span className="workshop-pitch-create-label"><FilePlus2 size={16} strokeWidth={1.5} />Create Artifact</span>
                <span className="workshop-pitch-button-hint">
                  {footerStatus.startsWith("Copied") ? <Check size={14} /> : <Copy size={14} />}
                  {footerStatus.startsWith("Copied") ? "instructions copied" : "copy agent instructions"}
                </span>
              </button>
            </div>
            {footerStatus && <p role="status">{footerStatus} <a href="/docs-human">Setup guide ↗</a></p>}
          </div>
        </div>
        <div className="workshop-footer-bottom">
          <a className="workshop-footer-license" href={`${REPO_URL}/blob/main/LICENSE`}>
            Open source <span aria-hidden="true">·</span> Apache 2.0
          </a>
          <nav aria-label="Footer">
            <a href="/examples">Gallery</a>
            <a href="/docs-human">Docs</a>
            <a href={REPO_URL}>
              GitHub <ArrowUpRight size={12} />
            </a>
            <a className="workshop-footer-legal" href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
          </nav>
        </div>
      </footer>
    </main>
  );
}
