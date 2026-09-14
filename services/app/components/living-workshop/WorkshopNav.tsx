import { useEffect, useState } from "react";
import { CircleUser, SlidersVertical } from "lucide-react";
import {
  PageMenu,
  PageControls,
  requestPageChrome,
} from "@/components/PageChrome";
import GitHubStar from "@/components/GitHubStar";
import { Tooltip } from "@/components/Tooltip";
import { useSession } from "@/web/session";

/** The workshop keeps its wordmark; navigation and preferences use the app's panels. */
export default function WorkshopNav({ solid = false }: { solid?: boolean }) {
  const { session } = useSession();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 32);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return (
    <>
      <header
        className={`workshop-nav${solid || scrolled ? " workshop-nav-solid" : ""}`}
      >
        <a href="/" className="workshop-wordmark" aria-label="artifactbin home">
          <img src="/logo-128.png" alt="" width={128} height={128} />
          artifactbin
        </a>
        <span className="workshop-tagline">Google Docs for agents</span>
        <nav aria-label="Main navigation">
          <a href="/examples">Gallery</a>
          <a href="/docs-human">Docs</a>
          <GitHubStar placement="desktop-bar" />
          <Tooltip content="Page controls">
            <button
              type="button"
              aria-label="Open page controls"
              onClick={() => requestPageChrome("controls")}
            >
              <SlidersVertical size={20} />
            </button>
          </Tooltip>
          <Tooltip content="Menu">
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => requestPageChrome("menu")}
            >
              <CircleUser size={20} />
            </button>
          </Tooltip>
        </nav>
      </header>
      <PageMenu
        authed={!!session?.user}
        anon={session?.kind === "anon"}
        fixed
        triggerless
        panelTop={64}
      />
      <PageControls fixed triggerless panelTop={64} />
    </>
  );
}
