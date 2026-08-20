---
name: organize-modules
description: Audit a repo's module/file organization against measured signals and deliver 5–8 themed, executable refactor plans toward deep services.
disable-model-invocation: true
---

# Organize Modules

Audit how a codebase's files and packages are organized and deliver **themes**: 5–8 named refactor plans, each turning measured friction into a target structure of **deep services** — packages that expose few exports and rich behavior. Work at the group level: where files live, what a package exports, how services relate. The interface design of an individual class or function is out of scope.

## 1. Scope

A scope the user named wins — skip inference. Otherwise run the analysis script (below) from the repo root, read its HOT SPOTS section, and propose the areas that keep changing as the scope; confirm that proposal with the user in one question. After scope is settled, run unattended — the next interaction is presenting the finished plans.

## 2. Evidence

Run the bundled script from anywhere inside the target repo:

```bash
node <this-skill's-directory>/scripts/analyze.mjs --scope <dir> [--pkg-depth <n>]
```

Pick `--pkg-depth` so a "package" matches the repo's real grouping unit (default 2 fits `src/<feature>/`). `--help` lists the rest; `--json` gives the full data.

The git-based sections (hot spots, co-change, hidden coupling, cohesion) are exact for any language. The import-graph sections are regex-extracted; the COVERAGE section reports how much resolved. When coverage is weak and the ecosystem has a native grapher — `npx madge`/`dependency-cruiser` (JS/TS), `go list` (Go), `import-linter`/`pydeps` (Python) — run it and prefer its graph.

Then classify every top-level directory in scope as **framework-owned** or **yours**. Framework-owned is layout the framework's own tooling reads — Next.js `app/`/`pages/`, Rails `app/models|controllers`, Go `cmd/`, Django app layout. Framework-owned directories keep their shape; the move available there is thinning their contents by delegating into your packages.

## 3. Diagnose

Judge in layers — a higher layer settles what it covers before a lower one speaks:

1. **Convention** — infer the repo's dominant organizing pattern from the tree itself. Inconsistency with its own convention is the first-class finding, ahead of any doctrine.
2. **Friction** — the measured signals from the script.
3. **Doctrine** — the six principles, as tiebreaker where the repo has no convention.

### The six principles

- **Package depth** — few exports over rich behavior; a package whose export count rivals its file count is a pass-through, not a service. *Signals:* EXPORT SURFACE. *Fix:* narrow behind a facade; merge shallow sibling packages into one deeper service.
- **Common closure** — files that change together live together. *Signals:* CROSS-PACKAGE CO-CHANGE, HIDDEN COUPLING (packages co-changing with no import edge share knowledge secretly), low PACKAGE COHESION (a package whose files never co-change is an accidental grouping). *Fix:* move the file to its true home; merge or dissolve the package. For application code, common closure outranks reuse.
- **Acyclic imports** — the package graph is a DAG; a cycle makes its members one de-facto package. *Signals:* PACKAGE CYCLES. *Fix:* invert one edge through an interface owned by the consumer, or extract the shared fragment both depend on. Invert only to break a cycle or a stability violation — inversion adds interface area and costs depth.
- **Common reuse** — importers shouldn't depend on things they don't use. *Signals:* GRAB-BAGS (high fan-in with high disjointness = clients using disjoint slices). *Fix:* split by client cluster; repatriate a single-client helper to its only caller.
- **Narrow contracts** — a package declares its public surface, and outsiders come through it. *Signals:* DEEP IMPORTS; sizable packages with `index: no`. *Fix:* add the facade, then the ecosystem's native enforcer (Go `internal/`, Packwerk, dependency-cruiser rules) so the boundary holds.
- **Screaming structure** — the top level names the domain, not the technology; layers live inside feature packages. *Signals:* top-level `controllers/`, `services/`, `models/` plus commits that fan across them for one feature. *Fix:* feature/context packages with layers inside each.

Across context boundaries, prefer duplication over coupling: sharing a model between distant packages is a stronger tie than the copied code ever was.

**Diagnosis is complete when every row the script reports above threshold is either claimed by a theme or dismissed in `diagnosis.md` with its reason.** Cherry-picking the fun findings and going quiet on the rest fails this bar.

## 4. Themes

Cluster the claimed findings into 5–8 themes. A theme is one coherent story — "make `billing` a deep service", "dissolve `src/utils`", "break the orders↔shipping cycle" — not a bucket of unrelated moves. Rank themes by hotspot weight: friction in code that changes outranks tidiness in code that doesn't. Size each theme to land as a short series of PR-sized batches.

## 5. Write the plans

Write to `docs/arch-plans/<yyyy-mm-dd>/` (or a path the user named). Earlier runs' directories stay untouched and unconsulted — every run judges fresh.

`diagnosis.md`: the scope and how it was chosen; the convention detected and the framework-owned/yours classification; every above-threshold signal with its disposition (which theme claimed it, or why dismissed); the theme index in rank order.

One `NN-<slug>.md` per theme, self-sufficient — **executable by a session holding only the plan file and the repo**:

- **Story** — the one-line theme and the target state: what the deep service looks like after.
- **Evidence** — the concrete signal numbers that justify it.
- **Batches** — ordered; each step an exact operation (move `from → to`, merge, split, facade with the symbols its index exports, reroute importers) with every file and config it touches.
- **Verification** — the build/test commands that must stay green.
- **Out of scope** — what the theme deliberately leaves alone, including any behavior change it refuses to fold in.

## 6. Present and stop

Summarize in the terminal — one line per theme in rank order, plus the plan paths. The run ends here.

When the user picks a theme — "execute theme 3", "do the utils one" — read [EXECUTE.md](EXECUTE.md) and follow it.
