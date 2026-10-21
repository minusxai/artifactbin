import { readFileSync } from "node:fs";
const font = (name, file, weight) =>
  `@font-face{font-family:'${name}';src:url(data:font/woff2;base64,${readFileSync(new URL("./browser/fonts/" + file, import.meta.url)).toString("base64")}) format('woff2');font-weight:${weight};font-style:normal;font-display:swap}`;
export const chromeCSS =
  font(
    "JetBrains Mono Variable",
    "jetbrains-mono-latin-wght-normal.woff2",
    "100 800",
  ) +
  font("IBM Plex Sans", "ibm-plex-sans-latin-400-normal.woff2", "400") +
  font("IBM Plex Sans", "ibm-plex-sans-latin-600-normal.woff2", "600") +
  readFileSync(new URL("./browser/chrome.css", import.meta.url), "utf8") +
  readFileSync(new URL("./browser/sharing.css", import.meta.url), "utf8");
