# Contributing

Thanks for helping with Town of Me. Start with [ARCHITECTURE.md](ARCHITECTURE.md) for where things live and
[AGENTS.md](AGENTS.md) for the rules every change follows; both apply whether you write the code yourself or with a
coding agent.

## Set up

Requirements: Node.js 26 or newer. Docker is optional (PostgreSQL and containers).

```sh
npm install
cp .env.example .env   # every value is optional for local work
npm run dev            # frontend on http://localhost:5173, backend on http://localhost:3000
```

Without `DATABASE_URL` the backend keeps data in memory and starts each time from the fictional sample town in
`backend/seed/town.json`. Signing in at `/admin` needs a LinkedIn developer app (see [backend/README.md](backend/README.md))
and your LinkedIn email in `ADMIN_EMAILS`.

## Make a change

- Keep a change to one feature, and to **one module**: `frontend/` or `backend/`. CI rejects a push or pull request that
  touches both, except a dependency-only change to the `package.json` files and the lockfile. Split API changes into a
  backend change first, then a frontend change.
- Follow the code style in [AGENTS.md](AGENTS.md); lint enforces most of it (`eslint.codeStyle.mjs`).
- Add a test only where a plausible bug in logic would otherwise go unnoticed (mutation-first, not test-first), and
  assert behavior rather than restating constants, copy, markup or layout.
- Before you push, run the checks for the module you touched, or `npm run check` for both:

  ```sh
  npm run lint --workspace frontend && npm run format:check --workspace frontend && npm test --workspace frontend && npm run build --workspace frontend
  ```

- Check visual changes in a browser, at a few times of day and seasons (the sun button in the HUD previews them).
- Explain what changed and why in the commit message. There is no changelog until the project publishes releases.

## Assets

Prefer procedural geometry and synthesized sound. A third-party file must be CC0 or similarly permissive, and gets a row
in [`frontend/public/assets/CREDITS.md`](frontend/public/assets/CREDITS.md) with its author, source, license, and
changes.

## Personal data

Never commit a real person's name, contact details, references, or LinkedIn link, including in tests and the sample
town. Real content belongs in a database through `/admin`, or in a private seed file outside git (`.seed/` is ignored).

## License of contributions

The project is licensed under the [Apache License 2.0](LICENSE). As its section 5 says, a contribution you submit is
licensed under the same terms unless you state otherwise.

## Security issues

Please do not open a public issue for a vulnerability; see [SECURITY.md](SECURITY.md).
