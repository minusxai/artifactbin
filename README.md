# artifactbin

artifactbin is Google Docs for agents: publish a self-contained document over HTTP, get a link; humans edit it in place.

Hosted instance: https://artifactbin.dev · Apache-2.0.

## Use it now

Install the CLI and set up browser authentication and local agent skills:

```sh
curl -fsSL https://artifactbin.dev/chat/install.sh | sh
```

afbin installs local skills for detected Claude Code, Codex, pi and OpenCode, and signs you in through your browser the first time it needs the server. Run `afbin auth` to sign in deliberately.
Ask the agent to publish or edit with `afbin pull`, local edits, `validate` and `push`.
Help, validation, status, diff and unchanged pushes work without server requests.
See [CLI usage](services/cli/README.md) for automation and installation options.

## Self-host

Requires Docker, `curl`, and Bash. Defaults: `./artifactbin`, port `3030`.

```bash
curl -fsSL https://artifactbin.dev/install.sh | bash
```

Choose the directory and port explicitly (add `--no-interview` for automation; run with `--help` for every option):

```bash
curl -fsSL https://artifactbin.dev/install.sh | bash -s -- --dir="$HOME/artifactbin" --port=3030
```

Verify with `curl -fsS http://localhost:3030/health` — that process's own liveness; `/api/health` answers whether the whole stack is ready (see [operations](docs/operations.md)). Follow logs with
`docker logs -f artifactbin`; stop it with `docker stop artifactbin`. Re-running
the installer upgrades the fixed `artifactbin` container and keeps the target's
`.env` and `data/`. Apple Silicon currently runs the `linux/amd64` image, so its
first 2+ GB image pull can take several minutes.

Manual container setup:

```bash
docker run --rm -it -v "$PWD/artifactbin:/work" ghcr.io/minusxai/artifactbin node scripts/setup.mjs --out /work/.env
docker run -d --name artifactbin --restart unless-stopped -p 127.0.0.1:3030:3000 -v "$PWD/artifactbin/data:/app/data" --env-file artifactbin/.env ghcr.io/minusxai/artifactbin
```

Data lives in `data/` (PGLite + objects). Email login needs `EMAIL__RESEND_API_KEY`; connecting the CLI anonymously works without it. Put a reverse proxy in front for TLS and set `APP__PUBLIC_BASE_URL` to the public URL.

For the bundled Postgres instead, use `docker compose up -d`; see [operations](docs/operations.md).

## Develop

Local development requires Node.js 22 and npm; embedded PGLite needs no Docker.

```bash
git clone https://github.com/minusxai/artifactbin
cd artifactbin
npm ci
npm run setup
npm run dev
```

Then open http://localhost:3030. Setup safely reuses `.env`, retaining custom values and filling missing secrets; Enter keeps a value, hidden secret input accepts `-` to clear it, and `--force` rebuilds from scratch.
Skip questions with `npm run setup -- --yes --port <port>`. A localhost public URL follows an explicitly changed port, while a custom deployment URL is preserved. Setup checks the app and HMR ports and suggests a free pair; `npm run dev` also reports an exact recovery command if either becomes busy.

```bash
npm test
npm run validate
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development flow.

## Docs

- [Editing and concurrent changes](docs/editing.md)
- [The document format](docs/document-format.md)
- [File uploads and accepted types](docs/file-uploads.md)
- [Adding JavaScript libraries and using file references](docs/javascript-libraries.md)
- [Serving and security](docs/serving-and-security.md)
- [Ownership and accounts](docs/ownership.md)
- [Operations and deployment](docs/operations.md)

Agent skills are installed locally by afbin on first use and updated explicitly with `afbin update`.
`afbin help` reads the same bundled guidance offline.

## License

[Apache-2.0](LICENSE).
