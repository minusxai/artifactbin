/**
 * THE CLI'S CONTRACT WITH THE APP, PART 4: what the local preview's connect page uses
 * (services/cli/src/preview/connect.tsx, its own page in the preview's browser bundle). Separate from
 * `./browser` because the bundler splits pages by file, not by name: through one shared entry this
 * page would load the preview page's whole document chrome.
 */
export { FileConnectReceiver, connectRequest } from '../../solid/components/FileConnectReceiver';
