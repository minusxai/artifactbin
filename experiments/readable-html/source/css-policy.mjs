import parse from "css-tree/parser";
import walk from "css-tree/walker";
import { ident } from "css-tree/utils";
/** Parse complete CSS, including custom-property values; never accept parser recovery.
 * @param {string} css
 * @param {'stylesheet'|'declarationList'|'value'} context
 */
export function validateCss(css, context) {
  const ast = parse(css, {
    context,
    parseCustomProperty: true,
    onParseError(error) {
      throw error;
    },
  });
  walk(ast, (node) => {
    if (node.type === "Raw") throw new Error("Unsupported unparsed CSS");
    if (
      node.type === "Atrule" &&
      ident.decode(node.name).toLowerCase() === "import"
    )
      throw new Error("External CSS import");
    if (node.type === "Url") {
      const value = node.value.trim();
      if (value && !value.startsWith("#") && !/^data:/i.test(value))
        throw new Error("External CSS URL");
    }
    if (node.type === "Function") {
      const name = ident.decode(node.name).toLowerCase();
      // Dynamic/string URL constructors require dependency resolution outside this profile.
      if (
        [
          "url",
          "src",
          "image",
          "image-set",
          "-webkit-image-set",
          "cross-fade",
          "-webkit-cross-fade",
          "attr",
        ].includes(name)
      )
        throw new Error("Unsupported CSS resource constructor: " + name);
    }
  });
}
