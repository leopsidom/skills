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

### Without npm

These skills also install straight from this repo with the
[`skills`](https://github.com/vercel-labs/skills) CLI, which needs nothing published:

```bash
npx skills add leopsidom/skills
```

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

### `git-workflow-best-practice`

Keeps `main` clean: the agent reads the current branch before every commit, lands work
through a feature branch and a pull request, opens PRs ready for review instead of as
drafts, and collapses a stack as soon as its predecessor merges.

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

## Making it stick

These skills are model-invoked, so the agent has to notice it should fire. That is a
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
