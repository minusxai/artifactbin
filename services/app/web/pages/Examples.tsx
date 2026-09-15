import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { SHOWCASE, SHOWCASE_FORMATS, type ShowcaseKind } from "@/lib/showcase";
import { ArtifactPrint } from "@/components/living-workshop/WorkshopDirections";
import "./examples.css";
import WorkshopNav from "@/components/living-workshop/WorkshopNav";

const FILTERS: { label: string; kinds: ShowcaseKind[] }[] = [
  { label: "All artifacts", kinds: [] },
  ...SHOWCASE_FORMATS.map(({ kind, label }) => ({
    label: label.charAt(0).toUpperCase() + label.slice(1),
    kinds: [kind],
  })),
];
export default function Examples() {
  const [filter, setFilter] = useState(0);
  useEffect(() => {
    const old = document.title;
    document.title = "The artifact wall — artifactbin";
    return () => {
      document.title = old;
    };
  }, []);
  const kinds = FILTERS[filter]!.kinds;
  const visible = SHOWCASE.map((doc, index) => ({ doc, index })).filter(
    ({ doc }) => !kinds.length || kinds.includes(doc.kind),
  );
  return (
    <main className="artifact-gallery">
      <WorkshopNav solid />
      <header className="gallery-intro">
        <span className="studio-eyebrow">THE ARTIFACT WALL</span>
        <h1>
          A few things
          <br />
          <em>made here.</em>
        </h1>
        <div>
          <p>
            A few useful things.
            <br />
            A few unexpected things.
            <br />
            See what catches your eye.
          </p>
          <span className="gallery-signature">Have a rummage. Find a gem.</span>
        </div>
      </header>
      <div className="gallery-filter-row">
        <div role="group" aria-label="Filter artifacts">
          {FILTERS.map((f, i) => (
            <button
              key={f.label}
              aria-pressed={filter === i}
              onClick={() => setFilter(i)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span role="status">{visible.length} artifacts</span>
      </div>
      <section className="artifact-wall" aria-label="Published artifacts">
        {visible.map(({ doc, index }) => (
          <article
            key={doc.id}
            className={`wall-artifact wall-artifact-${index}`}
          >
            <ArtifactPrint index={index} />
          </article>
        ))}
      </section>
      <footer className="gallery-footer">
        <span>THERE'S ROOM FOR YOURS, TOO.</span>
        <h2>What will you make?</h2>
        <a href="/#workshop-install">
          Pull up a chair <ArrowUpRight size={20} />
        </a>
      </footer>
    </main>
  );
}
