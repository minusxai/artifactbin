# Artifact server execution

An ordinary artifact may define one `<script type="server">` handler. Browser compilation excludes this script. The published source and version are pinned for execution; A separate Lambda artifact type is unnecessary.

Artifact server handlers execute using the existing V8 isolate runtime, with bounded CPU and memory and explicit capabilities. They do not allocate Modal boxes or receive native Node globals, filesystem access, or raw AF credentials. Invocation and operations retain the existing artifact permission checks.

Agents and user-created native programs execute on Modal boxes, with a persisted private home, terminal access and configured AF credentials. The shared run interface routes artifact handlers to isolates and native programs to Modal; these execution choices do not introduce another user-facing artifact primitive.
