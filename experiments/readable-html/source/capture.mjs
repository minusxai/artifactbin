/** Preserve the parsed document, including nodes outside its root element.
 * XMLSerializer is used only for DocumentType; HTML elements use HTML serialization.
 * @param {Document} document
 * @returns {string}
 */
export function captureDocument(document) {
  return Array.from(document.childNodes, (node) => {
    if (node.nodeType === 10)
      return new XMLSerializer().serializeToString(node);
    if (node.nodeType === 1) return /** @type {Element} */ (node).outerHTML;
    if (node.nodeType === 8) return "<!--" + node.nodeValue + "-->";
    if (node.nodeType === 3) return node.nodeValue || "";
    throw new Error("Unsupported document-level node");
  }).join("");
}
