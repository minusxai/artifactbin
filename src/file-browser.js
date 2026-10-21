/** @param {import('./file-browser-contracts.ts').FileSelection} state @param {import('./file-browser-contracts.ts').SelectionGesture} gesture */
export function selectPaths(
  state,
  { path, visible, toggle = false, range = false },
) {
  if (range && state.anchor && visible.includes(state.anchor)) {
    const a = visible.indexOf(state.anchor),
      b = visible.indexOf(path);
    return {
      paths:
        b < 0 ? state.paths : visible.slice(Math.min(a, b), Math.max(a, b) + 1),
      anchor: state.anchor,
    };
  }
  return {
    paths: toggle
      ? state.paths.includes(path)
        ? state.paths.filter((p) => p !== path)
        : [...state.paths, path]
      : [path],
    anchor: path,
  };
}
/** @param {string[]} paths */
export function movePaths(paths) {
  return [...new Set(paths)].filter(
    (path) =>
      !paths.some((parent) => parent !== path && path.startsWith(parent + "/")),
  );
}
/** @param {string[]} paths @param {string} destination */
export function canMoveTo(paths, destination) {
  return (
    paths.length > 0 &&
    paths.every(
      (path) =>
        destination !== path &&
        !destination.startsWith(path + "/") &&
        (path.slice(0, path.lastIndexOf("/")) || "/") !== destination,
    )
  );
}
/** @param {string} parent @param {string} name */
export function childPath(parent, name) {
  name = name.trim();
  if (!name || name === "." || name === ".." || /[\\/\u0000-\u001f]/.test(name))
    throw Error("Enter a name without slashes.");
  // The characters the server's paths refuse (normalizePath), named plainly.
  const refused = /[%?#\u007f]/.exec(name);
  if (refused)
    throw Error(
      "File and folder names can’t contain “" + refused[0] + "”. Rename it and try again.",
    );
  if (name.length > 120) throw Error("Use a name of up to 120 characters.");
  return (parent === "/" ? "" : parent) + "/" + name;
}
