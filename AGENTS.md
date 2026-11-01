# AGENTS.md

These instructions apply to the entire repository. Read [ARCHITECTURE.md](ARCHITECTURE.md) first for where code and
data live and how to extend the town; [CONTRIBUTING.md](CONTRIBUTING.md) covers setup.

## Working principle: Ponytail / YAGNI

Use the smallest complete change that solves the current problem. Before adding code, look for an existing implementation, then prefer the standard library, browser or runtime APIs, and already-installed dependencies. Do not add speculative abstractions, configuration, scaffolding, or dependencies. Fix shared root causes once instead of patching individual callers.

Do not simplify away validation at trust boundaries, error handling that prevents data loss, security controls, accessibility, or an explicit requirement.

## Repository layout and commands

The repository is an npm workspace with two isolated application modules. Install dependencies once at the repository root. Each change may modify application code in only one module.

```sh
npm install
```

Frontend (`frontend/`, Vite + React + Three.js):

```sh
cd frontend
npm run dev
npm run lint
npm run format:check
npm run test
npm run build
```

Backend (`backend/`, TypeScript):

```sh
cd backend
npm run lint
npm run format:check
npm test
npm run build
```

Equivalent root commands use `--workspace frontend` or `--workspace backend`. Run lint, format, test, and build for the one module touched by a change. Add a test only where a plausible bug in non-trivial logic would otherwise go unnoticed (see Code style); do not add a new test framework when the existing one is sufficient.

## Module boundary

- Choose `frontend/` or `backend/` before editing application code.
- Do not modify both module directories in one change. Split cross-module work into two independently reviewable changes.
- Root documentation, workflow, and workspace configuration may accompany one module change when required, but must not be used to hide edits to the other module.
- GitHub Actions rejects a push or pull request that changes both `frontend/` and `backend/`, except a dependency-only change (the modules' `package.json` files and the root lockfile), such as Dependabot opens.
- Follow the more specific `AGENTS.md` inside the selected module.

## Project skills

The portable skill source lives in `skills/`. Codex should load the matching project skill before these tasks:

- Security audit or security-boundary review: `skills/security-check/SKILL.md`
- Pull request, diff, commit, or working-tree review: `skills/code-review/SKILL.md`

Claude discovers thin wrappers under `.claude/skills/`; each wrapper imports the portable source with `@path`. Update the source in `skills/`, not the wrapper.

## Reviewable changes

- Keep each change set focused on one feature in one module, and independently reviewable.
- Touch the fewest files needed. Do not mix feature work with unrelated cleanup, renaming, or formatting.
- Reuse existing project patterns before creating a new layer or abstraction.
- Keep diffs easy to verify: separate mechanical changes from behavioral changes when both are necessary.
- Record what changed and why in the commit message. Keep no CHANGELOG until the project publishes versioned releases; git history is the record until then.

## Code style

Lint enforces the structural rules below in both modules (`eslint.codeStyle.mjs`).

- Make meaningful logic directly testable. Export module functions; do not keep file-private helpers (outside tests). A helper that does not fit its file's purpose belongs in another module, and non-component logic lives in `.ts` modules rather than component files.
- Use descriptive, expanded names that communicate intent. Avoid abbreviations and single-letter names; coordinates (`x`, `y`, `z`) are the exception.
- Add comments to functions or classes only when their intent, constraints, or reason is not obvious from the code. Explain why, not what the syntax does.
- Do not add `else` or `else if` branches. Prefer guard clauses, early returns, `continue`, or a small extracted function.
- A function body is the first level of nesting: a branch or loop may not contain another branch or loop. Loop bodies and iteration callbacks (`forEach`, `map`, `filter`, `reduce`, …) must not branch; pre-filter the input or extract the work into a named function.
- Reuse shared helpers (for example `frontend/src/motionMath.ts`) instead of redefining them.
- Prefer plain data and functions over classes unless identity or lifecycle makes a class materially simpler.
- Remove dead code instead of preserving it for hypothetical future use.
- Never commit a real person's data (names, contact details, references, LinkedIn links), including in tests and seeds; real content lives in the database or in the ignored `.seed/` folder.
- Write tests mutation-first, not test-first: add one only where a plausible bug in logic (a small mutation of the code) would otherwise go unnoticed. Assert behavior, not constants, copy text, markup, rendering or layout, or a restatement of the implementation. Prefer extending an existing test, and keep each suite fast by sampling cases rather than sweeping them exhaustively.

## Completion

Before finishing, inspect the final diff, confirm that only intended files changed, and report which relevant checks ran. If a check cannot run, state the reason rather than claiming success.
