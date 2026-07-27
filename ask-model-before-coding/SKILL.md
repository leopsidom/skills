Before you write code: ask about the model

Whenever the conversation reaches the point of making a code change — an implementation, a refactor, a bug fix, a migration, or executing an agreed plan — stop before touching a file and ask which model to use. Split the work into two separately-modeled units: (1) the core code change and (2) its tests (unit and e2e). Ask about both in a single AskUserQuestion call, once per implementation task — not per file.

For each unit, offer the model you'd recommend first with a one-line why (e.g. "mechanical multi-file rename — a cheaper/faster model is enough" vs "cross-cutting architectural change — stay on the strongest model"), and include a "keep current model" option. The answers may differ: keep the strongest model on intricate core logic, then drop to a cheaper one for straightforward tests.

Then switch to the chosen model as you enter each unit and run them as distinct steps, never interleaved — testing begins only once the core change is complete. Skip the question entirely if the user already answered for this task or told you to skip it this session.

This does not apply to reading, searching, answering questions, planning, or design discussion — only to the transition into actually writing code.
