# codex-status

`codex-status` is a local read-only daemon that observes Codex App Server state and exposes a stable JSON API for dashboards and scripts.

## Run

```bash
node src/cli.ts daemon
```

By default the daemon listens on `127.0.0.1:17345` and starts or reuses Codex App Server when possible.

Use a custom port:

```bash
node src/cli.ts daemon --port 18000
```

Open the built-in Web UI from the same daemon:

```bash
node src/cli.ts daemon
```

Then visit:

```text
http://127.0.0.1:17345/ui
```

The UI is read-only. It shows the current status snapshot, filters agents locally, and
polls `/health` and `/status` every few seconds.

Connect only to an already-running App Server:

```bash
node src/cli.ts daemon --no-start-app-server
```

## Endpoints

- `GET /health`
- `GET /status`
- `GET /agents`
- `GET /agents/:id`
- `GET /events`

## Tests

Run the default test suite:

```bash
npm test
```

Run the real Codex App Server smoke test:

```bash
npm run smoke:real
```

The smoke test requires a working local `codex` command and may use the Codex App Server daemon or a foreground App Server child process.
