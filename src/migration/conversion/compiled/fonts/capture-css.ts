import { parse, generate } from "css-tree";
import { parsePinnedFontRequest, validFontUnicodeRange } from "./inline.ts";
import { fontCaptureAddress } from "./capture-policy.ts";
import { FONT_CAPTURE_LIMITS } from "./capture-contracts.ts";
import type { CapturedFontFaceReceipt } from "./capture-contracts.ts";
export type CapturedFontDescriptor = Omit<
  CapturedFontFaceReceipt,
  "sha256" | "bytes"
>;
/** CSS is treated as data, never rendered or executed by the offline tool. */
export function admitCapturedFontCss(
  css: string,
  requestUrl: string,
): readonly CapturedFontDescriptor[] {
  const request = parsePinnedFontRequest(requestUrl);
  if (Buffer.byteLength(css) > FONT_CAPTURE_LIMITS.stylesheetBytes)
    throw Error("Font capture stylesheet limit");
  const ast = parse(css),
    faces: CapturedFontDescriptor[] = [];
  ast.children.forEach((rule: any) => {
    if (
      rule.type !== "Atrule" ||
      rule.name !== "font-face" ||
      rule.prelude ||
      !rule.block
    )
      throw Error("Captured stylesheet must contain only font faces");
    const properties = new Map<string, any>();
    rule.block.children.forEach((node: any) => {
      if (
        node.type !== "Declaration" ||
        node.important ||
        properties.has(node.property) ||
        ![
          "font-family",
          "font-style",
          "font-weight",
          "font-stretch",
          "font-display",
          "src",
          "unicode-range",
        ].includes(node.property)
      )
        throw Error("Captured font descriptor refused");
      properties.set(node.property, node.value);
    });
    const get = (key: string) =>
      properties.has(key) ? generate(properties.get(key)) : undefined;
    const names = properties.get("font-family")?.children?.toArray() ?? [];
    if (names.length !== 1 || names[0].type !== "String")
      throw Error("Captured font family refused");
    const family = names[0].value,
      style = get("font-style");
    const weights = /^([0-9]+)(?: ([0-9]+))?$/.exec(get("font-weight") ?? "");
    if (!weights || !["normal", "italic"].includes(style ?? ""))
      throw Error("Captured font style refused");
    const weight: readonly [number, number] = [
      Number(weights[1]),
      Number(weights[2] ?? weights[1]),
    ];
    if (weight[0] < 1 || weight[1] > 1000 || weight[0] > weight[1])
      throw Error("Captured font weight refused");
    const stretchValue = get("font-stretch");
    let stretch: readonly [number, number] | undefined;
    if (stretchValue) {
      const parts = /^([0-9]+(?:\.[0-9]+)?)%(?: ([0-9]+(?:\.[0-9]+)?)%)?$/.exec(
        stretchValue,
      );
      if (!parts) throw Error("Captured font stretch refused");
      stretch = [Number(parts[1]), Number(parts[2] ?? parts[1])];
    }
    const requested = request.families.find(
      (f) =>
        f.family === family &&
        style ===
          (f.axes.find((a) => a.tag === "ital")?.min === 1
            ? "italic"
            : "normal") &&
        f.axes.every(
          (a) =>
            a.tag === "ital" ||
            a.tag === "opsz" ||
            (a.tag === "wght" && a.min === weight[0] && a.max === weight[1]) ||
            (a.tag === "wdth" &&
              stretch?.[0] === a.min &&
              stretch?.[1] === a.max),
        ),
    );
    if (
      !requested ||
      get("font-display") !== request.display ||
      (Boolean(stretch) !== requested.axes.some((a) => a.tag === "wdth") &&
        !(
          stretch?.[0] === 100 &&
          stretch?.[1] === 100 &&
          !requested.axes.some((a) => a.tag === "wdth")
        ))
    )
      throw Error("Captured font request mismatch");
    const unicodeRange = get("unicode-range");
    if (!unicodeRange || !validFontUnicodeRange(unicodeRange))
      throw Error("Captured font Unicode coverage refused");
    const source = properties.get("src")?.children?.toArray() ?? [],
      format = source[1]?.children?.toArray() ?? [];
    if (
      source.length !== 2 ||
      source[0].type !== "Url" ||
      source[1].type !== "Function" ||
      source[1].name !== "format" ||
      format.length !== 1 ||
      format[0].type !== "String" ||
      format[0].value !== "woff2"
    )
      throw Error("Captured font source refused");
    fontCaptureAddress(source[0].value, "font");
    if (faces.length >= FONT_CAPTURE_LIMITS.faces)
      throw Error("Captured font face limit");
    faces.push({
      family,
      style: style as "normal" | "italic",
      weight,
      ...(stretch ? { stretch } : {}),
      unicodeRange,
      sourceUrl: source[0].value,
    });
  });
  if (
    !faces.length ||
    request.families.some(
      (f) => !faces.some((face) => face.family === f.family),
    )
  )
    throw Error("Captured font request incomplete");
  return faces;
}
/** Exact provider omissions are data, never generated faces or substitute families. */
export function capturedFontOmissions(
  faces: readonly CapturedFontDescriptor[],
  requestUrl: string,
) {
  const request = parsePinnedFontRequest(requestUrl);
  return request.families
    .filter(
      (f) =>
        !faces.some(
          (face) =>
            face.family === f.family &&
            face.style ===
              (f.axes.find((a) => a.tag === "ital")?.min === 1
                ? "italic"
                : "normal") &&
            f.axes.every(
              (a) =>
                a.tag === "ital" ||
                a.tag === "opsz" ||
                (a.tag === "wght" &&
                  a.min === face.weight[0] &&
                  a.max === face.weight[1]) ||
                (a.tag === "wdth" &&
                  a.min === face.stretch?.[0] &&
                  a.max === face.stretch?.[1]),
            ),
        ),
    )
    .map((f) => ({ family: f.family, axes: f.axes }));
}
