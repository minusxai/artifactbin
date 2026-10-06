/* @jsxImportSource solid-js */
import { Show, type JSX } from 'solid-js';

/** One heading rhythm across the workspace; pages supply only their title, detail and actions. */
export default function WorkspaceHeading(props: { title: string; description?: string; children?: JSX.Element }): JSX.Element {
  return <header class="workspace-heading"><div><h1>{props.title}</h1><Show when={props.description}><p class="workspace-description">{props.description}</p></Show></div>{props.children}</header>;
}
