# Backend isolate planning proof

Run `npm ci --prefix experiments/readable-html/isolates`, then `npm test --prefix experiments/readable-html/isolates` from the repository (root supplies tsx/esbuild/TypeScript). Uses pinned workerd and GraphQL; no root dependencies changed. This is a local contract experiment, **not an internet-facing sandbox service**.

A backend is one self-contained TypeScript file exporting `typeDefs` (GraphQL SDL), `schema` (resolver field manifest), and `resolve(field,args,context,capabilities)`. `deploy` validates and publishes the SDL and executable bundle together; versions are immutable and tenant-scoped. `schemaOf` supplies the gateway with the exact deployment SDL. GraphQL parsing/validation/coercion belongs at that gateway, not a second handwritten parser here.

`IsolateHost(limits?, capability?)` accepts an authenticated Principal separately from untrusted invocation JSON. The optional capability handler closes over that Principal, receives a JSON operation request and AbortSignal, and runs outside workerd. The isolate receives only `caps.invoke(request)`, through an actual service binding. Network is otherwise denied. Bind this to the connector host; never accept authority or raw database credentials from the request.

The deliberately narrow local execution contract starts a fresh workerd process for every call. Globals reset. No arbitrary imports, ambient environment variables, filesystem bindings, detached background jobs, or raw network. Source <=256KiB, input/output <=64KiB, <=8 capability calls. Deadline kills the entire subprocess; client cancellation aborts capability work and kills the subprocess. Temporary files and sockets are removed before returning.

The 256MiB RSS watchdog is a **kill threshold, not a memory cap**. Sampling can overshoot substantially; tests print actual peak measurements. Never deploy this harness as a hostile multi-tenant production boundary. The production host is provider-neutral: self-hosted workerd needs an OS/container sandbox and hard resource limits; managed isolate providers are alternatives, not dependencies. See the phase report for precise evidence and deployment requirements.

## Actual OS envelope proof

`docker build -t pagegi-isolate-proof:local experiments/readable-html/isolates/container` followed by `node experiments/readable-html/isolates/container/check.mjs` exercises the compiler and workerd under a hard 256MiB cgroup limit, zero swap, 0.5CPU quota, 64-process budget, non-root identity, read-only image, no host mounts, no network, seccomp and zero capabilities. It verifies a real OOM kill, actual CPU throttling, cleanup and recovery. The runner removes all disposable containers, including failures. The local proof image remains cached for repeat runs.

`node experiments/readable-html/isolates/container/cap-check.mjs` proves the actual connector seam across this envelope: workerd service binding → trusted in-container supervisor → bounded stdio → authenticated host connector → HTTP endpoint. The container retains network isolation and zero host mounts; credentials stay outside. Both harnesses assert successful removal and verify each container no longer exists.
