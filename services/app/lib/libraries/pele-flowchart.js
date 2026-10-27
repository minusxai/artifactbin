// Closed per-type module: no remote imports or shared registration state.
import {register} from "pele/core";
import diagram from "pele/diagrams/flowchart";
register(diagram);
export * from "pele/core";
