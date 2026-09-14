import { useState } from "react";
import { ArrowUpRight, ArrowRight, Minus } from "lucide-react";
import { SHOWCASE, showcaseHref, showcaseCardUrl } from "@/lib/showcase";
import { artSrc, REASONS } from "@/lib/landing-content";

export function ArtifactPrint({
  index,
  caption = true,
}: {
  index: number;
  caption?: boolean;
}) {
  const doc = SHOWCASE[index % SHOWCASE.length]!;
  return (
    <a className="studio-print" href={showcaseHref(doc)} aria-label={doc.title}>
      <div className="studio-print-sheet">
        <img src={showcaseCardUrl(doc)} alt="" loading="lazy" />
        <span className="studio-print-number">
          {String(index + 1).padStart(2, "0")} / ARTIFACTBIN
        </span>
      </div>
      {caption && (
        <div className="studio-print-caption">
          <span>{doc.kind}</span>
          <h3>
            {doc.title} <ArrowUpRight size={16} />
          </h3>
        </div>
      )}
    </a>
  );
}
// Each spread pairs two canonical examples; the gallery shares ArtifactPrint.
const BOOKS = [
  { title: "Follow the evidence", pages: [0, 2] },
  { title: "Tell the whole story", pages: [1, 3] },
  { title: "Put an idea into motion", pages: [4, 5] },
];

export default function WorkshopDirections() {
  const [active, setActive] = useState(0);
  const selected = REASONS[active]!;
  return (
    <div className="studio-directions" id="workshop-examples">
      <section
        id="direction-3"
        className="blue-gallery"
        aria-label="The blue room"
      >
        <div className="blue-gallery-heading">
          <span className="studio-eyebrow">
            With artifactbin you can make ...
          </span>
        </div>
        <div className="blue-library">
          {BOOKS.map((book, index) => (
            <article
              className="library-volume"
              key={book.title}
              aria-label={book.title}
            >
              <div className="library-spread">
                {book.pages.map((page) => (
                  <div className="library-leaf" key={page}>
                    <ArtifactPrint index={page} />
                  </div>
                ))}
              </div>
              <p className="library-caption">
                <span>0{index + 1}</span>
                {book.title}
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
            Good work.
            <br />
            <em>On your terms.</em>
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
          <a className="studio-text-link" href="/docs-human">
            See how it works <ArrowUpRight size={18} />
          </a>
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
