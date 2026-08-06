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

## Making it stick

This skill is model-invoked, so the agent has to notice it should fire. That is a
weaker trigger than an always-loaded instruction, and it is weakest at exactly the
moment the skill targets: mid-flow, between items of a plan, when nothing in the
conversation prompts a fresh look at the skill list.

If you want it to hold every time, add a one-line pointer to your `CLAUDE.md` or
`AGENTS.md` as well. The line stays in context on every turn; the skill body still
loads only when it fires:

```markdown
Before writing code for any task, invoke the `ask-model-before-coding` skill —
including at the start of each item when working through a plan or PR train.
```

## License

MIT
