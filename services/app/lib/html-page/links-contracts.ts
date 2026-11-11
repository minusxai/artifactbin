import type {HtmlDatasetLink,HtmlDeclaredQuery,HtmlDefaultConnectionLink} from '@artifactbin/contracts';
/** `connections`: the page's default-connection links (`href="default:…"`), apart from its stored datasets. */
/** `queries`: the page's declared queries (`<script type="application/sql" data-af-query data-af-dataset>`), as written. */
export interface HtmlPageDeclarations {datasets:readonly HtmlDatasetLink[];connections:readonly HtmlDefaultConnectionLink[];queries:readonly HtmlDeclaredQuery[]}
