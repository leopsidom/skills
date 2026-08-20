# Executing a theme

Loaded when the user picks a theme from a plan directory. Read the chosen plan file end to end before the first edit.

## Preconditions

- Clean working tree, and a feature branch created for the theme (`arch/<slug>`).
- **Drift check** — the repo is the source of truth; the plan is a map of it as of its date. Before each batch, verify the files it touches still exist where the plan says. Where the repo has drifted, adapt the step to the current tree and record the deviation for the final report. If drift has invalidated the theme's evidence — the target area was already reorganized — stop and tell the user instead of executing a stale plan.

## The hard rule

**Structure only.** Every edit relocates, renames, re-exports, or rewires an import; behavior is identical before and after each batch. A step that turns out to need a behavior change to work stops the batch: surface it to the user as a follow-up item, and keep the reorganization commits pure.

## The batch loop

One batch = one commit, reviewable on its own. Per batch, in order:

1. **Move** with `git mv`, so history follows the file.
2. **Rewire every reference** — imports and re-exports, test mocks and `moduleNameMapper`, tsconfig/vite/webpack aliases and path maps, build and test globs, CI paths, codegen configs, doc links. Finish with a plain-text search for the old path *and* the bare filename: it catches the stragglers import-aware rewrites miss (strings, comments, configs in formats you didn't think to check).
3. **Facade** — create or trim the package index exactly as the plan states, and route outside importers through it.
4. **Green gate** — detect the repo's own build and test commands (`package.json` scripts, `Makefile`, the CI workflow) and run them. Green: commit, next batch. Red: fix within the batch, or revert the batch and stop to report. The next batch starts only from green — a red batch never gets another batch piled on top.

## Done

The theme is complete when all batches are green and committed. Report: batches landed, drift adaptations made, behavior-change items surfaced and left out. Landing the branch (PR, review) belongs to the user's normal workflow, not this skill.
