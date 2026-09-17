/** Pure, bundled authoring knowledge. Reading it never initializes services. */
import {CLI_PROTOCOL_VERSION} from '@artifactbin/contracts';
import {STORY_THEME_NAMES,STORY_TEMPLATE_NAMES} from '../validation/atlas-schemas';
import {JSX_STORY_COMPONENT_NAMES} from '../jsx/components';
import {STORY_HTML_TAGS} from '../story-ui/component-names';
export const authoringCapabilities={
 protocol:CLI_PROTOCOL_VERSION,
 reference:'ref:<id>',
 allowlists:{version:CLI_PROTOCOL_VERSION,themes:STORY_THEME_NAMES,templates:STORY_TEMPLATE_NAMES,components:JSX_STORY_COMPONENT_NAMES,html_tags:STORY_HTML_TAGS},
} as const;
