/** Lightweight OSS introduction. Production supplies its marketing page at build time. */
export default function Landing() {
  return <main className="mx-auto max-w-3xl px-6 py-16">
    <nav aria-label="Main navigation" className="mb-12 flex gap-6"><a href="/">Artifactbin</a><a href="/docs-human">Docs</a><a href="/login">Sign in</a></nav>
    <section aria-label="About Artifactbin">
      <h1 className="text-4xl font-semibold">Create, edit and share interactive documents.</h1>
      <p className="mt-6 text-lg">Artifactbin brings documents, dashboards and datasets together. Work locally with the CLI, preview and edit in your browser, then publish when ready.</p>
      <p className="mt-4">Host artifacts for yourself or your team, with comments, sharing controls and revision history.</p>
      <pre className="my-8 overflow-x-auto rounded border p-4"><code>{'afbin add report.jsx\nafbin preview report.jsx\nafbin push report.jsx'}</code></pre>
      <div className="flex gap-6"><a href="/login">Sign in to your workspace</a><a href="/docs-human">Setup guide</a></div>
    </section>
  </main>;
}
