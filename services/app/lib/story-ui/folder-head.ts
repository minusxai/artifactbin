/**
 * WHAT A FOLDER SAYS ABOUT ITSELF — the three facts `<Files>` cannot derive
 * from the rows it is given.
 *
 * A folder document is `<Files data="$children" />` and nothing else, so
 * everything on the page comes from the children table — which knows nothing
 * about the folder holding it. Its NAME is a column of a row this listing does
 * not contain, its TRAIL is a lookup nobody has run, and its OWN ID is the one
 * thing an agent needs in order to file into it. A folder with one child and a
 * folder with none must both say where they are, so none of it can be inferred
 * from what is on the shelf.
 *
 * It travels on the island (StoryIslandData.folder) rather than being parsed
 * out of the document, because it is the ROW's, not the source's: renaming a
 * folder must not be a rewrite of its markup, and the id read out of a
 * customised `<Query>`'s SQL is a guess where the row's own id is a fact.
 *
 * VIEWER-DEPENDENT, and the trail is the half that matters: a public folder's
 * `ancestor_ids` can name a private parent, so the server includes only the
 * ancestors this reader may read (lib/folders folderHeadFor). Absent, never
 * redacted — an entry that said "a folder you may not see" would be the
 * existence oracle the uniform 404 exists to avoid.
 *
 * Pure and import-free: it is read by the document kit, which may not reach
 * into app chrome, and by the react-free island contract, which may not reach
 * into React.
 */

/** One ancestor of a folder, as the trail draws it. */
export interface FolderCrumb {
  id: string;
  title: string | null;
  /** Where the crumb links — the ancestor's own address. */
  url: string;
}

/** The folder a `<Files>` listing is OF. Absent on a listing that is not one. */
export interface FolderHead {
  /** The folder's own id — the `parent_id` an agent is told to publish under. */
  id: string;
  title: string | null;
  /** Root → parent, and ONLY the ancestors this viewer may read. */
  trail: FolderCrumb[];
}
