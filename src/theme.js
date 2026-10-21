// Runs before first paint; modules hydrate the selected theme without a light flash.
(() => {
  const params = new URLSearchParams(location.search);
  const embedded = params.get("embed") === "1";
  if (embedded) document.documentElement.classList.add("pg-embedded");
  const initial = embedded ? params.get("theme") : null;
  let theme;
  try {
    theme = localStorage.getItem("pagegi-theme");
  } catch {}
  if (initial === "light" || initial === "dark") theme = initial;
  if (theme !== "light" && theme !== "dark")
    theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();
