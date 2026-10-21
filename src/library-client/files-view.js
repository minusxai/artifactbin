import { createLibraryActions } from "./actions.ts";
import { libraryListing } from "./listing.ts";
import { UNREACHABLE } from "./transport.ts";
import { agentHandoff } from "./agent-handoff.ts";
import { selectPaths, movePaths, canMoveTo } from "../file-browser.js";
/** @param {import("./view-contracts.ts").FilesViewOptions} options
 * @returns {import("./view-contracts.ts").FilesView} */
export function mountFiles({
  $,
  request,
  reload,
  message,
  openSharing,
  folder,
}) {
  let files = [],
    folders = [],
    sharedFiles = [],
    username = "";
  const actions = createLibraryActions({
    folder,
    request,
    id: () => crypto.randomUUID(),
  });
  function decode(s) {
    const el = document.createElement("textarea");
    el.innerHTML = s;
    return el.value;
  }

  const parentPath = (path) => path.slice(0, path.lastIndexOf("/")) || "/";
  const nameOf = (path) => path.split("/").at(-1);
  const folderURL = (path) =>
    path === "/" ? "/" : "/?folder=" + encodeURIComponent(path);
  /** @type {import("./contracts.ts").LibraryLayout} */
  let layout = "gallery";
  function setLayout(next) {
    layout = next;
    $("files").dataset.layout = layout;
    for (const mode of ["gallery", "list"])
      $("layout-" + mode).setAttribute("aria-pressed", String(layout === mode));
  }
  $("layout-gallery").onclick = () => setLayout("gallery");
  $("layout-list").onclick = () => setLayout("list");
  setLayout(layout);
  let pathChange = null;
  let selection = { paths: [], anchor: null },
    visiblePaths = [];
  let dragging = false;
  let movingPaths = [],
    destination = folder,
    moveBusy = false;
  function pathDialog(change) {
    pathChange = change;
    $("path-title").textContent =
      change.kind === "folder" ? "New folder" : "Rename";
    $("path-label").textContent =
      change.kind === "folder" ? "Folder name" : "Name";
    $("path-input").value = change.from ? nameOf(change.from) : "";
    $("path-help").textContent =
      "In " + (folder === "/" ? "Documents" : folder);
    $("path-submit").textContent =
      change.kind === "folder" ? "Create folder" : "Save name";
    $("path-error").textContent = "";
    $("path-dialog").showModal();
    $("path-input").focus();
    $("path-input").select();
  }
  $("new-folder").onclick = () => pathDialog({ kind: "folder" });
  $("path-close").onclick = () => $("path-dialog").close();
  $("path-form").onsubmit = async (e) => {
    e.preventDefault();
    $("path-submit").disabled = true;
    try {
      if (pathChange.kind === "folder")
        await actions.createFolder($("path-input").value);
      else await actions.rename(pathChange.from, $("path-input").value);
      $("path-dialog").close();
      await reload();
    } catch (e) {
      $("path-error").textContent = e.message;
    } finally {
      $("path-submit").disabled = false;
    }
  };
  function updateSelection() {
    $("selection-actions").hidden = !selection.paths.length;
    $("selection-count").textContent = selection.paths.length + " selected";
    $("select-all").checked =
      visiblePaths.length > 0 &&
      visiblePaths.every((p) => selection.paths.includes(p));
    $("select-all").indeterminate =
      selection.paths.length > 0 && !$("select-all").checked;
    for (const row of $("files").children) {
      const selected = selection.paths.includes(row.dataset.path);
      row.classList.toggle("selected", selected);
      row.querySelector("input[type=checkbox]").checked = selected;
    }
  }
  $("select-all").onchange = (e) => {
    selection = {
      paths: e.target.checked ? [...visiblePaths] : [],
      anchor: null,
    };
    updateSelection();
  };
  $("clear-selection").onclick = () => {
    selection = { paths: [], anchor: null };
    updateSelection();
  };
  $("move-selected").onclick = () => openMove(selection.paths);
  function openMove(paths) {
    movingPaths = movePaths(paths);
    destination = folder;
    $("folder-filter").value = "";
    $("move-path").value = folder;
    $("move-error").textContent = "";
    $("move-title").textContent =
      "Move " +
      (paths.length === 1 ? nameOf(paths[0]) : paths.length + " items");
    renderTree();
    $("move-dialog").showModal();
    $("folder-filter").focus();
  }
  function renderTree() {
    const tree = $("folder-tree");
    tree.replaceChildren();
    const query = $("folder-filter").value.toLowerCase();
    for (const path of [
      "/",
      ...folders
        .slice()
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    ]) {
      if (path !== "/" && query && !path.toLowerCase().includes(query))
        continue;
      const row = document.createElement("button");
      row.type = "button";
      row.setAttribute("role", "treeitem");
      row.setAttribute(
        "aria-level",
        String(path === "/" ? 1 : path.split("/").length),
      );
      row.setAttribute("aria-selected", String(destination === path));
      row.disabled = moveBusy || !canMoveTo(movingPaths, path);
      row.style.paddingLeft =
        12 + (path === "/" ? 0 : path.split("/").length - 1) * 18 + "px";
      row.textContent =
        (path === "/" ? "⌂ Documents" : "▱ " + nameOf(path)) +
        (path === folder ? " · Current" : "");
      row.onclick = () => {
        destination = path;
        $("move-path").value = path;
        renderTree();
        tree.querySelector('[aria-selected="true"]')?.focus();
      };
      row.onkeydown = (e) => {
        const rows = [...tree.querySelectorAll("button:not(:disabled)")],
          index = rows.indexOf(row);
        let target;
        if (e.key === "ArrowDown") target = rows[index + 1];
        if (e.key === "ArrowUp") target = rows[index - 1];
        if (e.key === "Home") target = rows[0];
        if (e.key === "End") target = rows.at(-1);
        if (target) {
          e.preventDefault();
          target.focus();
        }
      };
      tree.append(row);
    }
    $("move-destination").textContent =
      "Documents" +
      (destination === "/" ? "" : destination.replaceAll("/", " / "));
    $("move-submit").disabled =
      moveBusy || !canMoveTo(movingPaths, destination);
  }
  $("folder-filter").oninput = renderTree;
  $("move-path").oninput = () => {
    destination = $("move-path").value.trim() || "/";
    renderTree();
  };
  $("move-close").onclick = $("move-cancel").onclick = () => {
    if (!moveBusy) $("move-dialog").close();
  };
  $("move-dialog").addEventListener("cancel", (e) => {
    if (moveBusy) e.preventDefault();
  });
  async function performMove(paths, target) {
    await actions.move(paths, target);
    selection = { paths: [], anchor: null };
    await reload();
    message(
      "Moved " + paths.length + " item" + (paths.length === 1 ? "" : "s") + ".",
    );
  }
  $("move-submit").onclick = async () => {
    if (moveBusy || !canMoveTo(movingPaths, destination)) return;
    moveBusy = true;
    renderTree();
    try {
      await performMove(movingPaths, destination);
      $("move-dialog").close();
    } catch (e) {
      $("move-error").textContent = e.message;
    } finally {
      moveBusy = false;
      renderTree();
    }
  };
  function dropTarget(element, target) {
    element.ondragover = (e) => {
      if (dragging && canMoveTo(movingPaths, target)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        element.classList.add("drop-target");
      }
    };
    element.ondragleave = () => element.classList.remove("drop-target");
    element.ondrop = async (e) => {
      e.preventDefault();
      element.classList.remove("drop-target");
      if (!dragging || !canMoveTo(movingPaths, target)) return;
      try {
        await performMove(movingPaths, target);
      } catch (e) {
        message(e.message);
      }
    };
  }
  function rowMenu(path, file) {
    const details = document.createElement("details");
    details.className = "row-menu";
    const trigger = document.createElement("summary");
    trigger.textContent = "⋯";
    trigger.setAttribute("aria-label", "Actions for " + nameOf(path));
    details.append(trigger);
    const menu = document.createElement("div");
    menu.className = "row-menu-items";
    const action = (label, fn) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.onclick = () => {
        details.open = false;
        fn();
      };
      menu.append(b);
    };
    action("Rename", () => pathDialog({ kind: "move", from: path }));
    action("Move to…", () =>
      openMove(selection.paths.includes(path) ? selection.paths : [path]),
    );
    if (file) {
      action("Share", () => openSharing(location.origin, file.fileId));
      action("Download", async () => {
        try {
          const r = await fetch("/api/library/" + file.fileId + "/download", {
            headers: { "X-Pagegi-Home": "1" },
          }).catch(() => {
            throw Error(UNREACHABLE);
          });
          if (!r.ok)
            throw Error("Please sign in again to download this document.");
          const url = URL.createObjectURL(await r.blob());
          const a = document.createElement("a");
          a.href = url;
          a.download = nameOf(path);
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (e) {
          message(e.message);
        }
      });
    } else if (
      !folders.some((p) => p.startsWith(path + "/")) &&
      !files.some((f) => f.path.startsWith(path + "/"))
    )
      action("Remove empty folder", async () => {
        try {
          await actions.removeFolder(path);
          await reload();
        } catch (e) {
          message(e.message);
        }
      });
    details.append(menu);
    details.addEventListener("toggle", () => {
      if (details.open)
        for (const other of document.querySelectorAll(".row-menu[open]"))
          if (other !== details) other.open = false;
    });
    return details;
  }
  function renderDiscovered(container, entries) {
    container.replaceChildren();
    for (const file of entries) {
      const row = document.createElement("article");
      row.className = "file";
      const link = document.createElement("a");
      link.className = "file-title";
      link.href = file.url;
      link.textContent = decode(file.title) || nameOf(file.path);
      row.append(link);
      container.append(row);
    }
  }
  function render() {
    renderDiscovered($("shared-files"), sharedFiles);
    $("shared-documents").hidden = !sharedFiles.length;
    const list = $("files");
    list.replaceChildren();
    const query = $("search").value.toLowerCase();
    let count = 0;
    const crumbs = $("breadcrumbs");
    crumbs.replaceChildren();
    let path = "";
    for (const part of ["Documents", ...folder.split("/").filter(Boolean)]) {
      const link = document.createElement("a");
      if (part !== "Documents") path += "/" + part;
      link.href = folderURL(path || "/");
      link.textContent = part;
      if (crumbs.childNodes.length)
        crumbs.append(document.createTextNode(" / "));
      dropTarget(link, path || "/");
      crumbs.append(link);
    }
    const listing = libraryListing({
      folder,
      files: files.map((f) => ({ path: f.path, title: decode(f.title || "") })),
      folders,
      query,
    });
    const missing = listing.state === "missing";
    $("library-title").textContent =
      folder === "/"
        ? "Artifacts"
        : missing
          ? "Folder not found"
          : nameOf(folder);
    const entries = [
      ...folders
        .filter((p) => parentPath(p) === folder)
        .sort()
        .map((path) => ({ path })),
      ...files.filter((f) => parentPath(f.path) === folder),
    ];
    visiblePaths = listing.visible;
    selection.paths = selection.paths.filter((p) =>
      entries.some((e) => e.path === p),
    );
    for (const entry of entries) {
      const path = entry.path;
      if (!visiblePaths.includes(path)) continue;
      count++;
      const isFile = Boolean(entry.fileId),
        row = document.createElement("article");
      row.className = "file";
      row.dataset.path = path;
      row.dataset.kind = isFile ? "artifact" : "folder";
      row.draggable = true;
      const check = document.createElement("input");
      check.type = "checkbox";
      check.setAttribute("aria-label", "Select " + nameOf(path));
      check.onclick = (e) => {
        selection = selectPaths(selection, {
          path,
          visible: visiblePaths,
          toggle: true,
          range: e.shiftKey,
        });
        updateSelection();
      };
      const mark = document.createElement("span");
      mark.className = isFile ? "document-mark" : "folder-mark";
      mark.setAttribute("aria-hidden", "true");
      mark.innerHTML = isFile
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h6"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7V5h6l2 3h10v12H3z"/></svg>';
      if (isFile && entry.previewUrl) {
        const preview = document.createElement("img");
        preview.src = entry.previewUrl;
        preview.alt = "";
        preview.loading = "lazy";
        preview.referrerPolicy = "no-referrer";
        preview.className = "artifact-preview";
        preview.onerror = () => preview.remove();
        mark.append(preview);
      }
      const info = document.createElement("div");
      info.className = "file-info";
      const link = document.createElement("a");
      link.href = isFile ? entry.url : folderURL(path);
      link.className = "file-title";
      link.textContent = isFile
        ? decode(entry.title || "") || nameOf(path)
        : nameOf(path);
      link.setAttribute("aria-label", nameOf(path));
      info.append(link);
      const meta = document.createElement("span");
      meta.className = "file-meta";
      meta.textContent = isFile
        ? entry.commentCount +
          " " +
          (entry.commentCount === 1 ? "comment" : "comments")
        : "Folder";
      row.append(check, mark, info, meta, rowMenu(path, isFile ? entry : null));
      row.onclick = (e) => {
        if (e.target.closest("a,button,input,details")) return;
        selection = selectPaths(selection, {
          path,
          visible: visiblePaths,
          toggle: e.metaKey || e.ctrlKey,
          range: e.shiftKey,
        });
        updateSelection();
      };
      row.ondragstart = (e) => {
        dragging = true;
        if (!selection.paths.includes(path)) {
          selection = { paths: [path], anchor: path };
          updateSelection();
        }
        movingPaths = movePaths(selection.paths);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", movingPaths.join("\n"));
        row.classList.add("dragging");
      };
      row.ondragend = () => {
        dragging = false;
        row.classList.remove("dragging");
        document
          .querySelectorAll(".drop-target")
          .forEach((el) => el.classList.remove("drop-target"));
        movingPaths = [];
      };
      if (!isFile) dropTarget(row, path);
      list.append(row);
    }
    updateSelection();
    // Only what applies: rows with their search and header, the empty card,
    // "no matches", or a folder that does not exist.
    const hasEntries =
      listing.state === "rows" || listing.state === "no-results";
    $("empty").hidden = listing.state !== "empty";
    $("empty").querySelector("h2").textContent =
      folder === "/"
        ? "Let’s create your first artifact."
        : "This folder is empty.";
    $("folder-missing").hidden = !missing;
    $("library-actions").hidden = missing;
    $("library-toolbar").hidden = !hasEntries && !selection.paths.length;
    $("list-heading").hidden = count === 0;
    $("no-results").hidden = listing.state !== "no-results";
  }
  $("search").oninput = render;
  $("files").addEventListener("keydown", (e) => {
    if (e.key === "Escape") $("clear-selection").click();
    if ((e.metaKey || e.ctrlKey) && e.key === "a") {
      e.preventDefault();
      selection = { paths: [...visiblePaths], anchor: null };
      updateSelection();
    }
  });
  async function createExample() {
    $("new-example").disabled = true;
    $("empty-example").disabled = true;
    message("Creating your example…");
    try {
      location.href = await actions.createExample();
    } catch (e) {
      message(e.message);
    } finally {
      $("new-example").disabled = false;
      $("empty-example").disabled = false;
    }
  }
  $("new-example").onclick = createExample;
  $("empty-example").onclick = createExample;
  // Handing a page to the person's coding agent: the agent writes and
  // publishes it itself, so nothing is created here, only text to paste.
  const copyLabel = "Copy agent instructions";
  function openAgent() {
    $("agent-text").value = agentHandoff(location.origin, username);
    $("agent-copy").textContent = copyLabel;
    $("agent-status").textContent = "";
    $("agent-dialog").showModal();
    $("agent-copy").focus();
  }
  $("new-page").onclick = openAgent;
  $("empty-agent").onclick = openAgent;
  $("agent-close").onclick = () => $("agent-dialog").close();
  $("agent-text").oninput = () => {
    $("agent-copy").textContent = copyLabel;
  };
  $("agent-copy").onclick = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw Error("No clipboard");
      await navigator.clipboard.writeText($("agent-text").value);
      $("agent-copy").textContent = "Copied — paste into your agent";
      $("agent-status").textContent = "";
    } catch {
      $("agent-status").textContent =
        "Could not copy. Select and copy the text above.";
    }
  };
  $("publish").onclick = () => $("upload").click();
  $("upload").onchange = async () => {
    const file = $("upload").files[0];
    if (!file) return;
    $("publish").disabled = true;
    message("Publishing " + file.name + "…");
    try {
      location.href = await actions.publish(file);
    } catch (e) {
      message(e.message);
    } finally {
      $("publish").disabled = false;
      $("upload").value = "";
    }
  };
  document.addEventListener("click", (event) => {
    for (const menu of document.querySelectorAll(".row-menu[open]"))
      if (!menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape")
      for (const menu of document.querySelectorAll(".row-menu[open]")) {
        menu.open = false;
        menu.querySelector("summary").focus();
      }
  });

  return {
    renderDiscovered,
    update(data) {
      username = data.username || "";
      files = data.files || [];
      folders = data.folders || [];
      sharedFiles = data.sharedFiles || [];
      render();
    },
  };
}
