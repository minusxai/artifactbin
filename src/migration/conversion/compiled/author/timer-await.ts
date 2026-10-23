import { Parser } from "acorn";
import type { LowerLegacyTimerAwait } from "./effect-source-contracts.ts";
/** The archived frame used this exact delay form before installing its controls.
 * Only a terminal standalone block may move its continuation into the owned clock;
 * no later statement may overtake the original awaited work.
 */
export const lowerLegacyTimerAwait: LowerLegacyTimerAwait = (source, lifetime) => {
  const ast = Parser.parse(source, { ecmaVersion: "latest", sourceType: "module" }) as any;
  const edits: { start: number; end: number; text: string }[] = [];
  const visit = (node: any, terminal: boolean): void => {
    if (!node || typeof node !== "object") return;
    if (!["Program", "BlockStatement"].includes(node.type)) return;
    if (node.type === "BlockStatement" && terminal) {
      const index = node.body.findIndex((statement: any) => {
        const expression = statement.expression;
        const promise = expression?.argument;
        const executor = promise?.arguments?.[0];
        const timer = executor?.body;
        return statement.type === "ExpressionStatement" && expression?.type === "AwaitExpression" &&
          promise.type === "NewExpression" && promise.callee?.name === "Promise" && promise.arguments.length === 1 &&
          executor?.type === "ArrowFunctionExpression" && executor.params.length === 1 && executor.params[0].type === "Identifier" &&
          timer?.type === "CallExpression" && timer.callee?.name === "setTimeout" && timer.arguments.length === 2 &&
          timer.arguments[0].type === "Identifier" && timer.arguments[0].name === executor.params[0].name &&
          timer.arguments[1].type === "Literal" && typeof timer.arguments[1].value === "number" &&
          Number.isFinite(timer.arguments[1].value) && timer.arguments[1].value >= 0;
      });
      if (index >= 0 && node.body.slice(0,index).every((prior: any) => ["VariableDeclaration", "EmptyStatement"].includes(prior.type))) {
        const statement = node.body[index];
        const delay = statement.expression.argument.arguments[0].body.arguments[1].value;
        const tail = source.slice(statement.end, node.end - 1);
        edits.push({ start: statement.start, end: node.end - 1, text: `${lifetime}.timeout(()=>{${tail}},${delay});` });
        return;
      }
    }
    // Descend only through standalone blocks along the final-statement path.
    // Functions, conditionals, loops and earlier sibling blocks stay untouched.
    if (terminal && node.body.length) visit(node.body.at(-1), true);
  };
  visit(ast, true);
  for (const edit of edits.sort((a,b)=>b.start-a.start)) source = source.slice(0,edit.start)+edit.text+source.slice(edit.end);
  return source;
};
