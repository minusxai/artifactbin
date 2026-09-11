import teaching from './generated/teaching.json';
import {STORY_THEME_NAMES,STORY_TEMPLATE_NAMES} from '../../app/lib/validation/atlas-schemas';
export {manPage} from './man';
export const localSkillFiles:Readonly<Record<string,string>>=teaching.files;
export const examples:Record<string,string>={
 editorial:'<article className="mx-auto max-w-3xl p-8"><h1>Report</h1><p>Explain the finding.</p></article>',
 dashboard:'<Helmet><Query name="sales" source="./sales.csv">{`select * from public.rows`}</Query></Helmet>\n<main className="p-8"><h1>Sales</h1><Table data="$sales" /></main>',
 deck:'<SlideDeck><Slide><h1>Presentation</h1><p>One clear point.</p></Slide></SlideDeck>',
 scrolly:'<main><section className="min-h-screen p-8"><h1>Story</h1><p>Begin here.</p></section></main>',
};
const referenceTopics=Object.fromEntries(Object.entries(localSkillFiles).filter(([path])=>path.startsWith('references/')).map(([path,text])=>[path.slice('references/'.length,-3),text]));
export const helpTopics:Record<string,string>={
 ...referenceTopics,
 data:referenceTopics['markup-data'],
 themes:`Available themes: ${STORY_THEME_NAMES.join(', ')}. Set theme in the YAML fence; null clears an explicit choice. Use help themes-<name> for a detailed guide.`,
 templates:`Available templates: ${STORY_TEMPLATE_NAMES.join(', ')}. Run afbin help <template> to print a local example.`,
 ...Object.fromEntries(Object.entries(examples).map(([name,body])=>[name,`---\ntemplate: ${name}\n---\n${body}\n`])),
};
