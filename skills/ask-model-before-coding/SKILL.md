---
name: ask-model-before-coding
description: Ask which model to use before writing code, splitting the work into a core-change unit and a tests unit. Use at the transition from discussion into editing files — an implementation, refactor, bug fix, or migration — and again before each item of a plan, PR train, or todo list. Applies in unattended runs too: background jobs, scheduled runs, subagents, and headless sessions all ask. Not for reading, searching, planning, or design discussion.
---

# Before you write code: ask about the model

**Whenever the conversation reaches the point of making a code change — an implementation, a refactor, a bug fix, a migration, or executing an agreed plan — stop before touching a file and ask which model to use.** Split the work into two separately-modeled units: (1) the core code change and (2) its tests (unit *and* e2e). Ask about both in a single `AskUserQuestion` call, once per implementation task — not per file.

**One implementation task = one item that would land as its own commit or PR.** A plan, PR train, or todo list is therefore *multiple* implementation tasks: ask again at the start of each item, immediately before its first file edit — not once up front for the whole list. Executing a list is the case where this rule is most often dropped, because the transition into each item happens mid-flow with no user prompt to re-trigger it; treat "I'm about to start the next item's code" as the trigger, every time.

For each unit, offer the model you'd recommend first with a one-line why (e.g. "mechanical multi-file rename — a cheaper/faster model is enough" vs "cross-cutting architectural change — stay on the strongest model"), and include a "keep current model" option. The answers may differ: keep the strongest model on intricate core logic, then drop to a cheaper one for straightforward tests.

Then switch to the chosen model as you enter each unit and run them as distinct steps, never interleaved — testing begins only once the core change is complete. Skip the question only if the user already answered for **this specific task**, or explicitly widened the scope of an answer themselves ("use X for the whole train", "skip the model question this session"). An answer given for one item of a list never carries to the next item on its own — do not infer a standing decision the user hasn't stated.

## Ask in background jobs too

Running unattended is **not** an exemption. A background job, a scheduled or cron run, a headless or non-interactive session, a subagent, a `/loop` iteration — each still asks before it writes code. The rule is about who picks the model, not about who happens to be watching, and an unattended run is exactly where an unasked question turns into the strongest model quietly burning through a long task, or a cheap one silently taking the intricate part.

Nobody being present to answer is not an answer. It is not "keep the current model", and it is not a licence to infer what the user would have picked. Ask, and let the run wait on it. If the question genuinely cannot be surfaced in that context, stop before the first file edit and report the model choice as unanswered — do not proceed on a default and mention it afterwards.

This does **not** apply to reading, searching, answering questions, planning, or design discussion — only to the transition into actually writing code.
