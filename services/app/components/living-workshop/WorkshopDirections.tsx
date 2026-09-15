import { useState } from "react";
import { ArrowUpRight, ArrowRight, Minus } from "lucide-react";
import { SHOWCASE, showcaseHref, showcaseCardUrl } from "@/lib/showcase";
import { artSrc, REASONS } from "@/lib/landing-content";

export function ArtifactPrint({
  index,
  placement = "gallery",
}: {
  index: number;
  placement?: string;
}) {
  const doc = SHOWCASE[index % SHOWCASE.length]!;
  // Seed the visual mix by placement so rerenders and hydration keep it steady.
  const seed = `${placement}:${doc.id}`.split("").reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0);
  const mount = ["tape", "pin", "corners", "corner-pins"][seed % 4];
  const kind = doc.kind === "eda" ? "EDA" : doc.kind.charAt(0).toUpperCase() + doc.kind.slice(1);
  return (
    <a className="studio-print" data-mount={mount} href={showcaseHref(doc)} aria-label={doc.title}>
      <div className="studio-print-sheet">
        <img src={showcaseCardUrl(doc)} alt="" loading="lazy" />
        <div className="studio-print-label">
          <span>{kind} / </span>
          <h3>{doc.title}</h3>
          <ArrowUpRight size={14} aria-hidden="true" />
        </div>
      </div>
    </a>
  );
}
// Each theme pairs two canonical examples using the gallery’s mounted prints.
const THEMES = [
  { title: "follow the evidence", pages: [0, 2] },
  { title: "tell compelling data stories", pages: [1, 3] },
  { title: "put ideas into action", pages: [4, 5] },
  { title: "build micro-apps with friends", pages: [0, 3] },
  { title: "create beautiful visuals", pages: [4, 5] },
];

export default function WorkshopDirections() {
  const [active, setActive] = useState(0);
  const selected = REASONS[active]!;
  return (
    <div className="studio-directions" id="workshop-examples">
      <section
        className="blue-gallery"
        aria-label="The blue room"
      >
        <div className="blue-gallery-heading">
          <span className="studio-eyebrow">
            With artifactbin you can ...
          </span>
        </div>
        <div className="blue-library">
          {THEMES.map((theme, index) => (
            <article
              className="workshop-theme"
              key={theme.title}
              aria-label={theme.title}
            >
              <div className="workshop-print-pair">
                {theme.pages.map((page) => (
                  <div className="workshop-mounted-print" key={page}>
                    <ArtifactPrint index={page} placement={theme.title} />
                  </div>
                ))}
              </div>
              <p className="library-caption">
                <span>0{index + 1}</span>
                {theme.title}
              </p>
            </article>
          ))}
          <a className="library-gallery-link" href="/examples">
            <span className="studio-eyebrow">THERE’S MORE ON THE WALL</span>
            <strong>
              <span>Enter the <em>gallery</em></span>
              <ArrowUpRight aria-hidden="true" />
            </strong>
            <span>Find something worth sharing</span>
          </a>
        </div>
      </section>
      <section
        className="blue-capabilities"
        aria-labelledby="workshop-outcomes-title"
      >
        <div>
          <span className="studio-eyebrow">
            FROM FIRST DRAFT TO SOMETHING YOU’RE PROUD OF
          </span>
          <h2 id="workshop-outcomes-title">
            <span>Agent-ready infrastructure.</span>
            <em>Out of the box.</em>
          </h2>
          <div className="blue-feature-choices">
            {REASONS.map((reason, index) => (
              <div key={reason.image}>
                <button
                  id={`outcome-${index}`}
                  aria-expanded={active === index}
                  aria-controls={`outcome-copy-${index}`}
                  onClick={() => setActive(index)}
                >
                  <span>0{index + 1}</span>
                  <strong>{reason.title}</strong>
                  {active === index ? (
                    <Minus size={18} />
                  ) : (
                    <ArrowRight size={18} />
                  )}
                </button>
                {active === index && (
                  <p
                    id={`outcome-copy-${index}`}
                    aria-labelledby={`outcome-${index}`}
                  >
                    {reason.body}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
        <figure>
          <img
            key={selected.image}
            src={artSrc(selected.image, "water", 760)}
            alt={selected.alt}
            loading="lazy"
          />
          <div
            className="outcome-thumbnails"
            role="group"
            aria-label="Preview the benefits"
          >
            {REASONS.map((reason, index) => (
              <button
                key={reason.image}
                aria-label={`Preview: ${reason.title}`}
                aria-pressed={active === index}
                onClick={() => setActive(index)}
              >
                <img
                  src={artSrc(reason.image, "water", 380)}
                  alt=""
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        </figure>
      </section>
    </div>
  );
}
