/**
 * WHERE A SCRIPT COMPONENT MOUNTS. A capitalized tag outside the kit registry is a component the document's Helmet
 * script exports: the compiler emits a mount node (`data-mx-mount="<Name>"`) whose children are the server-rendered
 * fallback, the page runtime renders the component into it (lib/islands/page-runtime), and the editor badges it and
 * keeps that fallback out of inline editing (solid/editor/dom-mounter). One definition for all three, free of the
 * compiler's graph so the editor chunk can read it.
 */
import type { JsxNode } from '@/lib/jsx/types';
import { JSX_STORY_COMPONENT_NAMES } from '@/lib/jsx/components';

const REGISTERED_COMPONENTS: ReadonlySet<string> = new Set(JSX_STORY_COMPONENT_NAMES);
/** Declarations and retired tags that validation refuses in a body: never a script component, so a stale document still reports them. */
const NEVER_SCRIPT_COMPONENTS: ReadonlySet<string> = new Set(['Helmet', 'Import', 'Value', 'Query', 'Mutation', 'Notify', 'Param']);

export const isScriptComponent = (node: JsxNode): boolean =>
  node.type === 'element' && node.isComponent && !REGISTERED_COMPONENTS.has(node.tag) && !NEVER_SCRIPT_COMPONENTS.has(node.tag);

/** The mount node's attribute; its value is the component's name. */
export const MOUNT_ATTR = 'data-mx-mount';
