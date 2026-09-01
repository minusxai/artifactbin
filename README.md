# artifact-bin

artifact-bin is Google Docs for agents: publish a self-contained document over HTTP, get a link; humans edit it in place.
People use it for reports, dashboards, slides, datasets, and charts created by an agent.

Hosted instance: https://artifactbin.dev · Apache-2.0.

## Use it now

Point any agent at the hosted instance:

> Read `https://artifactbin.dev/docs/artifact-bin/SKILL.md` and publish there.

That's the entire integration. Against `https://artifactbin.dev`, the API in one breath:

```
POST /api/artifacts  create ({markup}, title?, theme?, template?)
```

For MCP clients, add `https://artifactbin.dev/mcp` with no credentials and the client pops a browser — approve in one click as a guest or while logged in.

## Self-host

Requires Docker, `curl`, and Bash. Defaults: `./artifact-bin`, port `3030`.

```bash
curl -fsSL https://artifactbin.dev/install.sh | bash
```

Choose the directory and port explicitly (add `--no-interview` for automation;
run with `--help` for every option):

```bash
curl -fsSL https://artifactbin.dev/install.sh | bash -s -- --dir="$HOME/artifact-bin" --port=3030
```

Verify with `curl -fsS http://localhost:3030/health`. Follow logs with
`docker logs -f artifact-bin`; stop it with `docker stop artifact-bin`. Re-running
the installer upgrades the fixed `artifact-bin` container and keeps the target's
`.env` and `data/`. Apple Silicon currently runs the `linux/amd64` image, so its
first 2+ GB image pull can take several minutes.

Or set up and run the container manually:

```bash
docker run --rm -it -v "$PWD/artifact-bin:/work" ghcr.io/minusxai/artifactbin node scripts/setup.mjs --out /work/.env
docker run -d --name artifact-bin --restart unless-stopped -p 127.0.0.1:3030:3000 -v "$PWD/artifact-bin/data:/app/data" --env-file artifact-bin/.env ghcr.io/minusxai/artifactbin
```

Data lives in `data/` (PGLite + objects). Email login needs `EMAIL__RESEND_API_KEY`; anonymous tokens work without it. Put a reverse proxy in front for TLS and set `APP__PUBLIC_BASE_URL` to the public URL.

For the bundled Postgres instead, use `docker compose up -d`; see [operations](docs/operations.md).

## Develop

Local development requires Node.js 22 and npm; embedded PGLite needs no Docker.

```bash
git clone https://github.com/minusxai/artifactbin
cd artifactbin
npm install
npm run setup
npm run dev
```

Then open http://localhost:3030. For another port, use
`npm run setup -- --yes --port <port>` (omit `--yes` for the interactive setup).

```bash
npm test
npm run validate
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development flow.

## Docs

- [Editing and concurrent changes](docs/editing.md)
- [The document format](docs/document-format.md)
- [Serving and security](docs/serving-and-security.md)
- [Ownership and accounts](docs/ownership.md)
- [Operations and deployment](docs/operations.md)

The complete agent docs tree is served at [`/docs`](https://artifactbin.dev/docs).

## License

[Apache-2.0](LICENSE).
