/** Recoverable trash, using the same authenticated transport as the library. */
export function mountTrash({ request, reload, message }) {
  const button = document.createElement("button");
  button.textContent = "Trash";
  const panel = document.createElement("dialog");
  panel.setAttribute("aria-label", "Trash");
  const heading = document.createElement("h2");
  heading.textContent = "Trash";
  const help = document.createElement("p");
  help.textContent =
    "Deleted items remain recoverable and count toward storage.";
  const list = document.createElement("div");
  const close = document.createElement("button");
  close.textContent = "Close";
  close.onclick = () => panel.close();
  panel.append(heading, help, list, close);
  document.body.append(panel);
  document.getElementById("menu-documents")?.after(button);
  const owner = new URLSearchParams(location.search).get("owner");
  const suffix = owner ? "?owner=" + encodeURIComponent(owner) : "";
  async function refresh() {
    const data = await request("/api/trash" + suffix);
    list.replaceChildren();
    if (!data.entries.length) list.textContent = "Trash is empty.";
    for (const entry of data.entries) {
      const row = document.createElement("p");
      const name = document.createElement("span");
      name.textContent = entry.path + " ";
      const restore = document.createElement("button");
      restore.textContent = "Restore";
      restore.onclick = async () => {
        restore.disabled = true;
        try {
          await request(
            "/api/trash/" + encodeURIComponent(entry.id) + "/restore" + suffix,
            {},
          );
          await reload();
          await refresh();
        } catch (error) {
          message(error.message);
          restore.disabled = false;
        }
      };
      row.append(name, restore);
      list.append(row);
    }
  }
  button.onclick = async () => {
    try {
      await refresh();
      panel.showModal();
    } catch (error) {
      message(error.message);
    }
  };
}
