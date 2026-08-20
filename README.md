# @leopsidom/skills

Agent skills for [Claude Code](https://claude.com/claude-code).

## Install

```bash
npx @leopsidom/skills install            # into ~/.claude/skills — every project
npx @leopsidom/skills install --project  # into ./.claude/skills — this repo only
```

Then restart Claude Code, or run `/reload-skills`.

Install a subset by naming skills, and overwrite an existing copy with `--force`:

```bash
npx @leopsidom/skills install ask-model-before-coding --force
npx @leopsidom/skills list
```

The installer copies plain directories — nothing is symlinked, and nothing runs on
`npm install`. Delete a skill by removing its directory from `~/.claude/skills`.

Each skill lives in its own directory under `skills/` in this repo, and the installer
discovers them by looking for a `SKILL.md` inside each one. They install *flat* into the
target — `~/.claude/skills/ask-model-before-coding`, not `~/.claude/skills/skills/...` —
so the `skills/` directory is a detail of this repo's layout, not something that reaches
your machine. Adding a skill means adding a directory there; nothing needs registering.

### Without npm

These skills also install straight from this repo with the
[`skills`](https://github.com/vercel-labs/skills) CLI, which needs nothing published:

```bash
npx skills add leopsidom/skills
```

The `skills/<name>/SKILL.md` layout above is one of the standard locations that CLI
looks in, so this channel keeps working without any per-skill registration.

Note that it takes a GitHub `owner/repo`, **not** the npm package name — passing
`@leopsidom/skills` there is read as a repository path and fails with an unhelpful
error. That CLI also symlinks rather than copies by default, so the skills break if
you later move the directory it cloned into; `npx @leopsidom/skills install` copies.

## Skills

### `ask-model-before-coding`

Before the agent writes any code, it stops and asks which model to use — splitting
the work into two separately-modeled units: the core change, and its tests.

The point is that these two rarely want the same model. Intricate core logic wants
your strongest model; the tests that follow are often mechanical enough for a cheaper,
faster one. Left alone, an agent will silently spend the strongest model on both, or
whatever you happened to be on when the conversation started.

The rule that makes it hold up under pressure: **one implementation task = one item
that would land as its own commit or PR.** A plan or PR train is therefore *several*
tasks, and the question is asked again at the start of each one. That is the case where
this rule is most often dropped — the transition into the next item happens mid-flow,
with no user prompt to re-trigger it.

It deliberately does not fire for reading, searching, planning, or design discussion —
only for the transition into actually editing files.

It also fires in unattended runs — background jobs, scheduled runs, subagents, headless
sessions. That is the case where an agent is most tempted to skip it, and the one where
skipping costs the most: nobody is watching a long unattended task quietly run the
strongest model end to end, or hand the intricate part to a cheap one. Nobody being
present to answer is not an answer, so the run waits on the question rather than
inferring a default.

### `git-workflow-best-practice`

Keeps `main` clean: the agent reads the current branch before every commit, lands work
through a feature branch and a pull request, checks the branch merges cleanly into its
base before the PR goes up, opens PRs ready for review instead of as drafts, and
collapses a stack as soon as its predecessor merges.

The rule that does the real work is the branch check, and specifically that it is run
as its **own** command. An agent that chains it (`git branch --show-current && git
commit …`) has technically obeyed and learned nothing — the branch name appears after
the decision to commit is already made. It also has to run before *every* commit, not
just the first: a merged PR, a `git pull`, or a rebase can put the checkout back on
`main` between two commits of the same task, and nothing announces it. That is a real
way to push to `main` while believing you are on a feature branch.

It also carries the recovery, which is the part nobody remembers under pressure: a
commit that landed on `main` locally and is still unpushed is salvageable by branching
at `HEAD` first, verifying, and only then resetting `main` back to the remote.

The merge-conflict rule is the one that keeps a PR from going up already broken. It runs
`git merge-tree --write-tree origin/<base> HEAD` against whatever base the PR targets and
reads the **exit code** — which is the whole trick, because the older three-argument
`git merge-tree` prints conflict markers to stdout and exits `0` regardless, so a check
built on it calls every branch clean. The second trap is on the other side: `gh pr view
--json mergeable` right after `gh pr create` returns `UNKNOWN`, because GitHub computes
mergeability asynchronously. `UNKNOWN` is not `MERGEABLE`, and treating it as one is how a
conflicting PR gets declared green.

The stacked-PR rule exists because a stack is a liability with a short shelf life. The
agent re-reads the predecessor's state before opening the PR and again whenever it
returns to one, so a PR is left based on something other than `main` only while its
predecessor is genuinely still open. The trap it defuses is the rebase itself: under a
squash merge the predecessor arrives in `main` as one new commit, so its originals are
absent *by identity* even though their content is there. A plain `git rebase
origin/main` replays each of them onto a `main` that already has those changes and
produces a conflict per commit — which reliably reads as "the rebase is going wrong"
and invites an abort. `git rebase --onto origin/main origin/<predecessor>` drops
everything up to the predecessor's old tip and replays only the branch's own work.

### `organize-modules`

A user-invoked audit — you type `/organize-modules` — of how a codebase's files and
packages are organized. It delivers a diagnosis plus 5–8 **themes**: named refactor
plans, each turning measured friction into a target structure of *deep services* —
packages that expose few exports and rich behavior. It works at the group level (where
files live, what a package exports, how services relate); the interface design of an
individual class stays out of scope.

The measuring is done by a bundled zero-dependency Node script, not by the model's
impression of the tree: package-level import cycles, cross-package change coupling from
git history, packages that co-change with no import edge between them (hidden shared
knowledge), export-surface-to-size ratios, deep imports that bypass a declared index,
and grab-bag files whose importers use disjoint slices of them. The git-based signals
are exact for any language; the import graph is regex-extracted and reports its own
resolution coverage, so the agent knows when to reach for a native grapher instead.

Judgment is layered so doctrine comes last: the repo's own convention first
(inconsistency with itself is the first-class finding), measured friction second, and
six named principles only as tiebreaker — with framework-owned directories (Next.js
`app/`, Rails `app/models`, Go `cmd/`) explicitly off-limits to reshaping.

The rule that does the real work is the accounting bar: **every signal the script
reports above threshold must be either claimed by a theme or dismissed in the diagnosis
with a reason.** Without it, an agent cherry-picks the fun findings and goes quiet on
the rest, and the audit silently shrinks to whatever was interesting that day.

Plans are written to be executed cold — a later session holding only the plan file and
the repo can perform them. Execution itself is a separate branch of the skill with two
rails: every batch is behavior-preserving (structure only — a step that needs a behavior
change stops and surfaces it), and every batch ends at a green gate — the repo's own
build and tests pass before the next batch starts, and a red batch gets fixed or
reverted, never buried.

## Making it stick

`ask-model-before-coding` and `git-workflow-best-practice` are model-invoked, so the
agent has to notice it should fire. That is a
weaker trigger than an always-loaded instruction, and it is weakest at exactly the
moment they target: mid-flow, between items of a plan or just before a commit, when
nothing in the conversation prompts a fresh look at the skill list.

If you want them to hold every time, add a one-line pointer to your `CLAUDE.md` or
`AGENTS.md` as well. The line stays in context on every turn; the skill body still
loads only when it fires:

```markdown
Before writing code for any task, invoke the `ask-model-before-coding` skill —
including at the start of each item when working through a plan or PR train.

Before any `git commit`, `git push`, or `gh pr create`, invoke the
`git-workflow-best-practice` skill — including before each later commit in a session.
```

`organize-modules` needs no pointer: it is user-invoked, so you reach it by typing
its name.

## Publishing (maintainers)

```bash
npm login                                                    # once, for registry.npmjs.org
npm version patch                                            # or minor / major
npm publish --@leopsidom:registry=https://registry.npmjs.org/
git push --follow-tags
```

The scope override is load-bearing on any machine whose `.npmrc` maps `@leopsidom`
to GitHub Packages. A `@scope:registry` entry outranks both the `publishConfig.registry`
in `package.json` **and** the `--registry` flag, so without it `npm publish` silently
lands a private package on GitHub Packages that nobody can `npx`. Confirm the target
before trusting it:

```bash
npm publish --dry-run --@leopsidom:registry=https://registry.npmjs.org/
# → Publishing to https://registry.npmjs.org/ with tag latest and public access
```

## License

MIT
