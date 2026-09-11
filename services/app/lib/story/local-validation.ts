/** Pure authoring checks shared by server preparation and the bundled CLI. */
import {parseJsx,validateJsx,type ValidationError} from '@/lib/jsx';
import {syntaxErrorDetail} from '@/lib/jsx/syntax-error';
import {JSX_STORY_COMPONENT_NAMES} from '@/lib/jsx/components';
import {STORY_HTML_TAGS} from '@/lib/story-ui/component-names';
import {splitHelmet,validateHelmet,type HelmetSplit} from './helmet';
import {analyzeRowScopes} from './row-scope';
import {collectRefNameUses,validateDataflow} from './dataflow';
import {managedIframeSourceErrors} from './managed-iframe-source';
import {findBrokenEmbeds,findExternalSubresources} from './refs';

export function validateMarkupStructure(source:string):{errors:ValidationError[];split?:HelmetSplit}{
 const parsed=parseJsx(source);
 if(!parsed.ok)return{errors:[syntaxErrorDetail(source,parsed)]};
 const split=splitHelmet(parsed.nodes);
 const helmetErrors=validateHelmet(parsed.nodes);
 return{split,errors:[
  ...helmetErrors,
  ...analyzeRowScopes(split.body).errors.map(message=>({message})),
  ...validateJsx(split.body,{components:JSX_STORY_COMPONENT_NAMES,allowedHtmlTags:STORY_HTML_TAGS,stylePolicy:'no-inline-style'}),
  ...managedIframeSourceErrors(split.body),...findExternalSubresources(source),...findBrokenEmbeds(source),
  ...(helmetErrors.length?[]:validateDataflow({values:split.content.values,queries:split.content.queries,mutations:split.content.mutations},collectRefNameUses(split.body))),
 ]};
}
