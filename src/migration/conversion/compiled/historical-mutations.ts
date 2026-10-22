import { Parser } from "acorn";
import jsx from "acorn-jsx";
import { readLocalSourceLiteral } from "./source-manifest.ts";
import type { ReadHistoricalRemoteMutationNames } from "./historical-mutation-contracts.ts";
export const readHistoricalRemoteMutationNames: ReadHistoricalRemoteMutationNames =
  (source) => {
    const tree = Parser.extend(jsx()).parse("<>" + source + "</>", {
      ecmaVersion: "latest",
      sourceType: "module",
    });
    const names: string[] = [];
    function visit(node: any, parent?: string): void {
      if (!node || typeof node !== "object") return;
      let next = parent;
      if (node.type === "JSXElement") {
        const tag = node.openingElement.name.name;
        next = tag;
        if (
          tag === "Mutation" &&
          node.openingElement.attributes.some(
            (a: any) => a.name?.name === "source",
          )
        ) {
          if (parent !== "Helmet")
            throw Error("Remote mutation must be a Helmet declaration");
          const attrs: Record<string, unknown> = Object.create(null);
          for (const attr of node.openingElement.attributes) {
            if (
              attr.type !== "JSXAttribute" ||
              !["name", "source", "expectedAffected", "reset"].includes(
                attr.name.name,
              ) ||
              Object.hasOwn(attrs, attr.name.name)
            )
              throw Error("Unsupported remote mutation declaration");
            attrs[attr.name.name] = readLocalSourceLiteral(attr.value);
          }
          if (
            typeof attrs.name !== "string" ||
            !/^[A-Za-z][A-Za-z0-9_]*$/.test(attrs.name) ||
            ["constructor", "prototype", "__proto__"].includes(attrs.name) ||
            names.includes(attrs.name) ||
            typeof attrs.source !== "string" ||
            !/^ref:[A-Za-z0-9]{6,12}$/.test(attrs.source)
          )
            throw Error("Invalid remote mutation identity");
          names.push(attrs.name);
        }
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach((v) => visit(v, next));
        else if (value && typeof value === "object") visit(value, next);
      }
    }
    visit(tree);
    return names;
  };
