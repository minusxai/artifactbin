import { SHOWCASE, showcaseHref } from '@/lib/showcase';
export default function Examples() {
 return <main className="mx-auto max-w-3xl px-6 py-16"><nav aria-label="Main navigation"><a href="/">Artifactbin</a> · <a href="/login">Sign in</a></nav><h1 className="my-8 text-3xl">Example artifacts</h1><ul className="space-y-4">{SHOWCASE.map(doc=><li key={doc.id}><a href={showcaseHref(doc)}>{doc.title}</a></li>)}</ul></main>;
}
