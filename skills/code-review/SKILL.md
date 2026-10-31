---
name: code-review
description: Review code changes for correctness, regressions, and testability while enforcing this project's readability and control-flow conventions. Use for pull requests, diffs, commits, or working-tree reviews; do not edit code unless explicitly asked.
---

# Code Review

Review the requested change without modifying files. If the review scope is unclear, infer the narrowest useful diff from the request and repository state, and state that scope.

## Review priorities

Inspect changed behavior, affected callers, tests, and relevant contracts. Report only issues supported by code evidence and a concrete failure mode.

Prioritize findings as:

- **P0**: immediate widespread failure, data loss, or release blocker.
- **P1**: likely serious bug or regression.
- **P2**: real defect with limited impact or a meaningful testability/maintenance risk.
- **P3**: small but actionable project-convention issue.

For each finding, include a precise file and line, the triggering condition, the impact, and the smallest reasonable correction. Do not inflate severity, list speculative risks, or treat personal taste as a defect.

## Project conventions

Apply the "Reviewable changes" and "Code style" sections of the root `AGENTS.md`, and the module `AGENTS.md`, without demanding unrelated refactors. Lint already enforces the structural rules, so report only what it cannot catch.

Treat convention findings as P3 unless they create a concrete correctness, regression, or testing risk that justifies a higher priority.

## Output

List findings first in descending priority. Keep summaries brief and avoid praise or a file-by-file walkthrough. If no actionable findings exist, say so explicitly and mention any material test coverage or verification gap. Do not apply fixes unless the user asks for implementation.
