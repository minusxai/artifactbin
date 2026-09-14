import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { SHOWCASE, type ShowcaseKind } from "@/lib/showcase";
import { ArtifactPrint } from "@/components/living-workshop/WorkshopDirections";
import "./examples.css";
import WorkshopNav from "@/components/living-workshop/WorkshopNav";

const FILTERS: { label: string; kinds: ShowcaseKind[] }[] = [
  { label: "All work", kinds: [] },
  { label: "Stories & reports", kinds: ["report", "data story"] },
  { label: "Dashboards", kinds: ["dashboard", "eda"] },
  { label: "Plans & presentations", kinds: ["product plan", "deck"] },
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
            Some start with a question.
            <br />
            Some start with a spreadsheet.
            <br />
            All of them are worth a closer look.
          </p>
          <span className="gallery-signature">Pick a page. Stay curious.</span>
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
            <p>{doc.blurb}</p>
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
