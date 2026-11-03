/**
 * The dataset links a page's first save stores, derived by the same pure parse publishing runs
 * (lib/html-page `htmlPageDeclarations`). API tests compare stored rows against it instead of a literal: the stored
 * shape is pinned once, in the fast lib/html-page links test, so a shape change fails that test on the pull request
 * rather than API tests after merge. scripts/__tests__/stored-shape-pins.test.mjs keeps literal stored dataset links
 * out of the API tests.
 */
import type {HtmlDatasetLink} from '@artifactbin/contracts';
import {htmlPageDeclarations} from '@/lib/html-page';
export const firstSaveLinks=(html:string):HtmlDatasetLink[]=>[...htmlPageDeclarations(html).datasets];
