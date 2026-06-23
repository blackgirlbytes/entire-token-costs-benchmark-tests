# Research Checkpoint - 2026-06-23

This note captures the working context from the Codex conversation that created
and reran the Entire token-cost benchmark. It exists because the benchmark repo
has an Entire checkpoint trailer for the session, but a plain git-tracked note
is easier for a future reviewer to inspect without depending on transcript
replay.

## Current Question

We are testing whether an agent that uses Entire can spend fewer total worker
tokens than an otherwise similar agent using normal CLI/source/git inspection.

The first serious answer is: not yet on this task set. Entire can improve the
quality of historical grounding, but the current worker prompts often make the
agent pay for both historical context and normal source investigation.

## What Is Pushed

- Benchmark repo: `blackgirlbytes/entire-token-costs-benchmark-tests`.
- Main benchmark script: `scripts/token-benchmark.mjs`.
- Task manifest: `benchmarks/token-cost/tasks.json`.
- Current attached Codex session: `019ef35b-2300-75e0-98d6-8e4dce14050f`.
- Current checkpoint trailer used on recent commits: `Entire-Checkpoint:
  a71156299398`.

## Key Results

1. Three-replicate run:
   - Baseline: 9/9 pass, 4,701,593 worker tokens.
   - Entire: 9/9 pass, 5,976,238 worker tokens.
   - Entire used 27.11% more worker tokens overall.
   - Level 2 evolution slightly favored Entire; progression/navigation and
     favicon favored baseline.
   - Result file:
     `benchmarks/token-cost/results/replicates-3-2026-06-23-run-2026-06-23T19-42-56-421Z-109d16/summary.md`.

2. Level 2 strategy ablation:
   - All modes passed.
   - Baseline was cheapest in that replicate.
   - `entire-search-first` was the cheapest Entire strategy, but still above
     baseline for that specific ablation.
   - Result file:
     `benchmarks/token-cost/results/ablation-level-2-2026-06-23-run-2026-06-23T20-47-04-297Z-0bfc68/summary.md`.

3. Gated Entire run:
   - Baseline: 3/3 pass, 1,063,608 worker tokens.
   - `entire-gated`: 3/3 pass, 1,433,363 worker tokens.
   - `entire-gated` used 34.77% more worker tokens overall.
   - Result file:
     `benchmarks/token-cost/results/gated-2026-06-23-run-2026-06-23T21-11-46-371Z-3c924f/summary.md`.

## What We Learned

The gated prompt changed behavior in the intended direction:

- No broad `entire checkpoint search` calls.
- No broad checkpoint-list exploration.
- Each gated worker used only 2-4 Entire commands.
- Each gated worker used one git-trailer probe.
- Each gated worker used 1-2 targeted `entire checkpoint explain` calls.

But gated Entire still cost more because the worker also:

- Loaded the local `using-entire` skill file.
- Read checkpoint/history evidence.
- Then performed substantial conventional source/git inspection anyway.

So the current benchmark may be measuring duplicated context-gathering cost
more than the theoretical value of Entire.

## Reviewer Questions

A different reviewer model should audit the methodology before more expensive
replicates:

- Are these tasks too easy for baseline, making historical context mostly
  overhead?
- Are the prompts causing Entire users to over-document provenance compared
  with baseline users?
- Is loading the local `using-entire` skill inside every child trial fair, or
  should the benchmark test a mode that provides the minimal command recipe in
  the prompt and forbids skill-file loading?
- Should the next arm precompute checkpoint snippets outside the worker and
  inject only the relevant excerpts into the prompt?
- Should the metric separate gross tokens from billable tokens after cache
  reads, or continue comparing total worker tokens?

## Next Recommended Ablations

1. `entire-no-skill`: allow `entire status`, one trailer lookup, and targeted
   explains, but explicitly forbid reading `.codex/skills/using-entire/SKILL.md`
   or other local skill files inside child trials.

2. `entire-precomputed-context`: have the harness run the Entire lookup before
   the worker starts, then pass a small checkpoint excerpt bundle to both arms
   or to a dedicated Entire arm. This tests whether the historical evidence
   itself helps without charging every worker for discovery mechanics.

3. Task-fit split: add tasks where history should matter more than source
   inspection, such as "why did this design change", "restore removed behavior",
   or "continue a prior partial implementation from checkpoint intent".

## Current Interpretation

Entire is not automatically token-saving. It becomes expensive when the agent
uses it as an additional research layer instead of a replacement for source
rediscovery. The promising direction is to make Entire usage narrower,
precomputed, or task-gated so it supplies only the context that baseline would
otherwise spend many source/git reads reconstructing.
