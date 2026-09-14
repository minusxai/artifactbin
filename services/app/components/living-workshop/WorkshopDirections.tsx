import { useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  MessageCircle,
  Pencil,
  Database,
} from "lucide-react";
import { SHOWCASE, showcaseHref, showcaseCardUrl } from "@/lib/showcase";
import { artSrc } from "@/lib/landing-content";
import "./workshop-directions.css";

const FEATURES = [
  {
    label: "Edit",
    title: "Your hands. Your finishing touches.",
    body: "Change the words, move things around, and make the final call. The first draft is just the beginning.",
    image: "human_editable",
    icon: Pencil,
  },
  {
    label: "Collaborate",
    title: "Keep the conversation on the page.",
    body: "Annotate the exact thing you mean. People and agents can respond, make changes, and resolve comments together.",
    image: "collaboration",
    icon: MessageCircle,
  },
  {
    label: "Explore data",
    title: "A document with something underneath.",
    body: "Keep the data behind the story. Query it with SQL, explore the results, and build interactive views without stuffing every row into a prompt.",
    image: "token-efficient",
    icon: Database,
  },
];

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
function DirectionLabel({
  number,
  title,
  note,
}: {
  number: string;
  title: string;
  note: string;
}) {
  return (
    <header className="direction-label">
      <span>Direction {number}</span>
      <strong>{title}</strong>
      <p>{note}</p>
    </header>
  );
}

/** An isolated, local sample: no publishing, external messages, or account state. */
export function WorkbenchDemo() {
  const [mode, setMode] = useState(0);
  const [title, setTitle] = useState("A season of small beginnings");
  const [comment, setComment] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [region, setRegion] = useState("All regions");
  const bars = region === "Europe" ? [22, 38, 61, 84] : [38, 64, 92, 128];
  return (
    <div className="workbench-demo">
      <div
        className="studio-demo-tabs"
        role="group"
        aria-label="Try the sample"
      >
        {FEATURES.map((f, i) => (
          <button
            key={f.label}
            aria-pressed={mode === i}
            onClick={() => setMode(i)}
          >
            <f.icon size={15} />
            {f.label}
          </button>
        ))}
      </div>
      <div className="sample-spread">
        <div className="sample-document">
          <span className="studio-eyebrow">FIELD NOTES / NO. 04</span>
          {mode === 0 ? (
            <input
              aria-label="Sample document title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          ) : (
            <h3>{title}</h3>
          )}
          <p>
            A few useful ideas became a little more useful when we worked on
            them together.
          </p>
          <div
            className="sample-bars"
            aria-label={`${region} sample project growth`}
          >
            {bars.map((v, i) => (
              <div key={i}>
                <span style={{ height: `${v / 1.4}px` }} />
                <small>Q{i + 1}</small>
              </div>
            ))}
          </div>
          <div className="sample-caption">
            {region} · {bars[3]} projects
          </div>
          <div className="sample-rule-lines" />
        </div>
        <aside className="sample-margin">
          <span className="studio-eyebrow">A SMALL LIVE SAMPLE</span>
          {mode === 0 && (
            <>
              <Pencil size={27} />
              <h4>Go on. Change the headline.</h4>
              <p>
                Click the title and type. A small taste of editing directly on
                the page.
              </p>
            </>
          )}
          {mode === 1 && (
            <>
              <MessageCircle size={27} />
              <h4>Right here, in context.</h4>
              <p className="sample-existing-note">
                Could we show how this changed over time?
                <small>Alex · sample comment</small>
              </p>
              {notes.map((note, i) => (
                <p className="sample-existing-note" key={i}>
                  {note}
                  <small>You · local sample</small>
                </p>
              ))}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (comment.trim()) {
                    setNotes([...notes, comment.trim()]);
                    setComment("");
                  }
                }}
              >
                <input
                  aria-label="Your sample comment"
                  placeholder="Leave a thought…"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  maxLength={160}
                />
                <button type="submit" disabled={!comment.trim()}>
                  Add comment <ArrowRight size={14} />
                </button>
              </form>
            </>
          )}
          {mode === 2 && (
            <>
              <Database size={27} />
              <h4>Follow your curiosity.</h4>
              <p>Choose a region to change the sample chart.</p>
              <select
                aria-label="Sample data region"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
              >
                <option>All regions</option>
                <option>Europe</option>
              </select>
              <code>
                SELECT quarter, projects
                <br />
                FROM sample_growth
              </code>
            </>
          )}
          <small className="sample-local-note">
            Illustrative data. Changes stay in this page.
          </small>
        </aside>
      </div>
    </div>
  );
}

export default function WorkshopDirections() {
  const [active, setActive] = useState(0);
  const selected = FEATURES[active]!;
  return (
    <div className="studio-directions" id="workshop-examples">
      <section
        id="direction-1"
        className="studio-direction direction-workbench"
        aria-label="Direction 01: The workbench"
      >
        <DirectionLabel
          number="01"
          title="The workbench"
          note="Paper, pins, and a little room to play."
        />
        <div className="workbench-collection">
          <div className="studio-heading">
            <span className="studio-eyebrow">MADE HERE</span>
            <h2>
              Look what
              <br />a little curiosity
              <br />
              <em>can make.</em>
            </h2>
            <p>
              A report. A working dashboard. A story with the data still
              attached.
            </p>
            <a className="studio-text-link" href="/examples">
              Visit the artifact wall <ArrowUpRight size={19} />
            </a>
            <span className="studio-handnote">Real work. Open any page.</span>
          </div>
          <div className="workbench-papers">
            <ArtifactPrint index={0} />
            <ArtifactPrint index={1} />
            <ArtifactPrint index={3} />
          </div>
        </div>
        <div className="workbench-making">
          <div className="studio-heading">
            <span className="studio-eyebrow">AFTER THE FIRST DRAFT</span>
            <h2>
              Make it <em>yours.</em>
              <br />
              Then make it <em>ours.</em>
            </h2>
            <p>Edit by hand. Think together. Get closer to the data.</p>
          </div>
          <WorkbenchDemo />
        </div>
        <p className="direction-note">
          01 / Most tactile. A natural continuation of the workshop, with a
          hands-on product moment.
        </p>
      </section>

      <section
        id="direction-2"
        className="studio-direction direction-fieldguide"
        aria-label="Direction 02: The field guide"
      >
        <DirectionLabel
          number="02"
          title="The field guide"
          note="An editorial collection. Quiet, spacious, and made to read."
        />
        <div className="fieldguide-intro">
          <span className="studio-eyebrow">THE ARTIFACTBIN COLLECTION</span>
          <h2>
            Worth making.
            <br />
            <em>Worth opening.</em>
          </h2>
          <p>
            Useful things, beautifully put together.
            <br />
            Every page starts with a conversation.
          </p>
        </div>
        <div className="fieldguide-book">
          <div className="fieldguide-leaf">
            <span className="studio-eyebrow">01 / A QUESTION, EXPLORED</span>
            <ArtifactPrint index={2} />
            <p>Follow a question through the evidence.</p>
          </div>
          <div className="fieldguide-leaf">
            <span className="studio-eyebrow">02 / A STORY, SHARED</span>
            <ArtifactPrint index={3} />
            <p>Let the data do some of the talking.</p>
          </div>
        </div>
        <a className="studio-text-link fieldguide-all" href="/examples">
          Browse the whole collection <ArrowUpRight size={18} />
        </a>
        <div className="fieldguide-features">
          {FEATURES.map((f, i) => (
            <article key={f.label}>
              <span className="fieldguide-chapter">0{i + 1}</span>
              <div>
                <span className="studio-eyebrow">{f.label}</span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
                <a className="studio-text-link" href="/docs-human">
                  See how it works <ArrowUpRight size={16} />
                </a>
              </div>
              <img src={artSrc(f.image, "water", 760)} alt="" loading="lazy" />
            </article>
          ))}
        </div>
        <p className="direction-note">
          02 / Most editorial. Bigger margins, slower rhythm, and space to
          explain what makes the product different.
        </p>
      </section>

      <section
        id="direction-3"
        className="studio-direction direction-blue"
        aria-label="Direction 03: The blue room"
      >
        <DirectionLabel
          number="03"
          title="The blue room"
          note="A bolder gallery. Cobalt ink, cream paper, confident scale."
        />
        <div className="blue-gallery">
          <div className="blue-gallery-heading">
            <span className="studio-eyebrow">
              A PLACE FOR THE THINGS YOU MAKE
            </span>
            <h2>
              Small beginnings.
              <br />
              <em>Wide possibilities.</em>
            </h2>
            <a className="studio-text-link" href="/examples">
              Enter the gallery <ArrowUpRight size={19} />
            </a>
          </div>
          <div className="blue-gallery-prints">
            <ArtifactPrint index={4} />
            <ArtifactPrint index={0} />
            <ArtifactPrint index={5} />
          </div>
          <p>Documents, dashboards, data stories, and whatever comes next.</p>
        </div>
        <div className="blue-capabilities">
          <div>
            <span className="studio-eyebrow">MORE THAN A FINISHED PAGE</span>
            <h2>
              A first draft
              <br />
              with a <em>future.</em>
            </h2>
            <div className="blue-feature-choices">
              {FEATURES.map((f, i) => (
                <button
                  key={f.label}
                  onClick={() => setActive(i)}
                  aria-expanded={active === i}
                >
                  <span>0{i + 1}</span>
                  <strong>{f.label}</strong>
                  {active === i ? (
                    <Check size={18} />
                  ) : (
                    <ArrowRight size={18} />
                  )}
                </button>
              ))}
            </div>
            <p>{selected.body}</p>
            <a className="studio-text-link" href="/docs-human">
              Explore what you can do <ArrowUpRight size={18} />
            </a>
          </div>
          <figure>
            <img
              key={selected.image}
              src={artSrc(selected.image, "water", 760)}
              alt={selected.title}
              loading="lazy"
            />
            <figcaption>{selected.title}</figcaption>
          </figure>
        </div>
        <p className="direction-note">
          03 / Most graphic. A strong cobalt moment, then one focused feature at
          a time.
        </p>
      </section>
    </div>
  );
}
