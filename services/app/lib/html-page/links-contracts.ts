import type {HtmlDatasetLink,HtmlDefaultConnectionLink} from '@artifactbin/contracts';
/** `connections`: the page's default-connection links (`href="default:…"`), apart from its stored datasets. */
export interface HtmlPageDeclarations {datasets:readonly HtmlDatasetLink[];connections:readonly HtmlDefaultConnectionLink[]}
