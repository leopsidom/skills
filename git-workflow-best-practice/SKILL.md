---
name: git-workflow-best-practice
description: Keep `main` clean — read the current branch before every commit, land work through a feature branch and a pull request, verify the branch merges cleanly into its base before opening the PR, open PRs ready for review rather than draft, and rebase a stacked PR onto `main` once its predecessor merges. Use immediately before any `git commit`, `git push`, or `gh pr create`, again before each later commit in the same session, and whenever returning to a stacked PR.
---

# Git workflow: `main` only advances through merged PRs

That is an **invariant**, not a starting condition: it has to hold at every commit of a session, not just the first one. All changes land on a feature branch and reach `main` through a merged pull request. The rules below are what keep it true.

## Read the branch before every commit

Run `git branch --show-current` as its own command, read the output, and only then commit. Treat it as a **precondition** of the commit — a value you evaluate and act on.

Keeping it a separate call is the whole point. Chaining it (`git branch --show-current && git commit …`) puts the branch name on screen after the decision to commit is already made, so the check costs a line and buys nothing.

Re-run it before **every** commit, not just the first. The checkout drifts: a merged PR, a `git pull`, a rebase, or another tool can put you back on `main` between two commits of the same task, and nothing announces it.

If the check reports `main`, create or switch to a feature branch, then commit.

### Recovering a commit that already landed on `main`

While it is local and unpushed, the commit is recoverable. Create the feature branch at the current `HEAD` so the branch carries the commit, verify it with `git log origin/main..HEAD`, and only once you see the commit listed there, move `main` back with `git reset --hard origin/main`. The reset discards everything on `main` that the remote does not have, so the verification is what makes it safe.

## Land work through a feature branch and a pull request

Branch, commit, push the branch, open a PR. `main` advances by merging that PR and by nothing else — no direct commits, no direct pushes, no force-pushes.

## Check the branch merges cleanly into its base before opening the PR

Whenever a PR goes up against a branch, verify first that there is no merge conflict against that branch. Fetch, then test the merge against the **base the PR will target** — `main` normally, the predecessor for a stack:

```bash
git fetch origin
git merge-tree --write-tree origin/<base> HEAD >/dev/null; echo $?
```

`0` means the merge is clean and the PR can go up. `1` means conflicts: rebase onto the base, resolve them, and re-run the check before pushing.

```bash
git rebase origin/<base>
git push --force-with-lease
```

Force-pushing here is the feature branch, which is yours to rewrite; the prohibition above is on `main`.

Read the **exit code**, not the output. The older three-argument `git merge-tree <base> <branch1> <branch2>` prints conflict markers to stdout but exits `0` either way, so a check written against it reports every branch clean — including the ones that conflict. `--write-tree` is what makes the status meaningful, and it needs git 2.38 or newer.

The result is a snapshot of the base as of that `git fetch`. It goes stale the moment the base moves, so re-run it before a later push to the same PR rather than trusting the check that passed when the branch was first opened.

Once the PR exists, confirm GitHub reached the same conclusion:

```bash
gh pr view <number> --json mergeable,mergeStateStatus
```

`CONFLICTING` means it conflicts. `UNKNOWN` means GitHub has not finished computing it — mergeability is calculated asynchronously, so a query fired immediately after `gh pr create` usually returns `UNKNOWN`. That is *not* a clean result; wait a few seconds and query again until it settles on `MERGEABLE` or `CONFLICTING`.

## Open pull requests active, not draft

Use plain `gh pr create`. A PR whose work is complete and whose gates pass goes up ready for review.

Draft is for a PR that genuinely is not ready for one: work still in progress, a known-failing gate, a deliberate placeholder, or a stacked PR blocked on an unmerged predecessor. When you open a draft, say in the body why it is a draft and what has to clear before it is ready, then run `gh pr ready <number>` as soon as that clears.

## Re-check the predecessor before opening a stacked PR

A **stacked** PR is one whose branch sits on another feature branch that has its own PR open. Treat that stack as a liability rather than a structure worth preserving: it earns its existence only while the predecessor is unmerged. Before opening the PR — and again each time you return to one already open — fetch and read the predecessor's real state instead of assuming it still holds:

```bash
git fetch origin
gh pr view <predecessor-branch> --json state,mergedAt
```

**Merged** — the stack is gone. Rebase onto `main` and open against `main`:

```bash
git rebase --onto origin/main origin/<predecessor-branch>
gh pr create --base main
```

Rebase with `--onto`, not a plain `git rebase origin/main`. A squash merge lands the entire predecessor as **one new commit**, so its original commits are absent from `main` by identity even though their content arrived; a plain rebase then dutifully replays each of them onto a `main` that already has those changes and hands you a conflict per commit. `--onto` drops everything up to the predecessor's old tip and replays only this branch's own commits. `origin/<predecessor-branch>` still names that old tip after the merge whenever the remote branch outlives it; when the merge deleted it, take the tip from `git reflog show <predecessor-branch>`.

**Open** — keep the stack. Open against the predecessor as a draft, naming the PR it waits on in the body:

```bash
gh pr create --base <predecessor-branch> --draft
```

Then once the predecessor merges, run the merged path above and re-target the PR you already opened:

```bash
gh pr edit <number> --base main
gh pr ready <number>
```

Either way the PR ends up based on `main`, and a base other than `main` means a predecessor that is still genuinely open.

Whichever base the PR lands on, run the merge check above against **that** base before opening it — and again after re-targeting, since a branch that merged cleanly into the predecessor has proven nothing about `main`.
