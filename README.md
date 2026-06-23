# Entire Token Cost Benchmark Tests

Benchmark harness for comparing agent runs with and without Entire CLI
assistance.

The core question is:

> Does using Entire CLI reduce model token cost to reach an accepted result,
> compared with using the same coding agent without Entire?

## Method

The harness runs paired trials:

1. Pick a real task from a target repository.
2. Start both arms from the same commit.
3. Run a fresh `codex exec --json` worker session for each arm.
4. Run configured checks such as `npm run build`.
5. Run a blind reviewer model that sees the task, final answer/diff, and checks,
   but not which arm produced the work.
6. Save verdicts, token usage, check logs, and summarized results.

The main metric is worker token cost to accepted output. Reviewer token usage is
recorded separately as experiment overhead.

## Arms

- `baseline`: Entire is disabled and `entire` commands are blocked.
- `entire`: Entire is enabled and the worker is encouraged to use targeted
  checkpoint/explain commands first, with search as an optional secondary
  source when it returns useful repo-scoped results.

## Current Pilot

Saved pilot runs:

- [summary.md](benchmarks/token-cost/results/pilot-2026-06-23-run-2026-06-23T08-15-33-275Z-4528a2/summary.md)
- [summary.json](benchmarks/token-cost/results/pilot-2026-06-23-run-2026-06-23T08-15-33-275Z-4528a2/summary.json)
- [corrected summary.md](benchmarks/token-cost/results/corrected-pilot-2026-06-23-run-2026-06-23T14-54-19-606Z-0bac51/summary.md)
- [corrected summary.json](benchmarks/token-cost/results/corrected-pilot-2026-06-23-run-2026-06-23T14-54-19-606Z-0bac51/summary.json)
- [improved-harness summary.md](benchmarks/token-cost/results/improved-harness-2026-06-23-run-2026-06-23T18-11-07-499Z-3584e2/summary.md)
- [improved-harness summary.json](benchmarks/token-cost/results/improved-harness-2026-06-23-run-2026-06-23T18-11-07-499Z-3584e2/summary.json)
- [3-replicate summary.md](benchmarks/token-cost/results/replicates-3-2026-06-23-run-2026-06-23T19-42-56-421Z-109d16/summary.md)
- [3-replicate summary.json](benchmarks/token-cost/results/replicates-3-2026-06-23-run-2026-06-23T19-42-56-421Z-109d16/summary.json)
- [Level 2 ablation summary.md](benchmarks/token-cost/results/ablation-level-2-2026-06-23-run-2026-06-23T20-47-04-297Z-0bfc68/summary.md)
- [Level 2 ablation summary.json](benchmarks/token-cost/results/ablation-level-2-2026-06-23-run-2026-06-23T20-47-04-297Z-0bfc68/summary.json)

Important caveats:

- The first pilot was launched before setup rewrote benchmark clone remotes back
  to the real GitHub `origin` URL. Treat it as a loop-mechanics pilot, not a
  final estimate.
- A follow-up diagnostic found that auth is healthy, but repo-scoped
  `entire checkpoint search` currently returns zero Planetfall results or times
  out. Local `entire checkpoint explain --json --limit 100` works in both the
  source repo and benchmark clone. See the
  [diagnostic summary](benchmarks/token-cost/results/diagnostic-2026-06-23-entire-search-vs-explain/summary.md).
- After changing the Entire prompt to start from local checkpoint metadata, the
  improved-harness rerun showed 31.10% fewer Entire worker tokens
  (1,313,069 vs 1,905,634) and a higher pass rate (3/3 vs 2/3).
- In synthetic benchmark branches, broad checkpoint listing may return `[]`;
  the harness now tells the Entire arm to discover checkpoint IDs from
  `Entire-Checkpoint:` git trailers and then run targeted
  `entire checkpoint explain <id> --json --no-pager`.
- The 3-replicate rerun showed high variance and reversed the single-run
  headline: both modes passed all 9 trials, but Entire used 27.11% more worker
  tokens overall. Level 2 evolution slightly favored Entire; progression and
  favicon favored baseline.
- The first Level 2 ablation showed all modes passing, with baseline cheapest
  and `entire-search-first` the cheapest Entire strategy in that replicate.
  This suggests command strategy changes behavior, but variance remains large.
- The gated Entire run avoided broad search/list calls and used only targeted
  checkpoint probes, but still used 34.77% more worker tokens than baseline
  across the three tasks. See the
  [gated summary](benchmarks/token-cost/results/gated-2026-06-23-run-2026-06-23T21-11-46-371Z-3c924f/summary.md).

## Ablation Modes

The harness supports `--modes` to compare command strategies:

- `baseline`: blocks Entire and uses normal repo inspection.
- `entire`: current balanced Entire prompt.
- `entire-search-first`: starts with `entire checkpoint search --json`.
- `entire-list-first`: starts with broad checkpoint metadata.
- `entire-trailer-first`: starts from `Entire-Checkpoint:` git trailers, then
  targeted `entire checkpoint explain`.
- `entire-gated`: caps Entire to a small evidence probe and falls back quickly.

## Usage

From a local checkout:

```bash
node scripts/token-benchmark.mjs setup
node scripts/token-benchmark.mjs run --dry-run
node scripts/token-benchmark.mjs run --execute
```

Common overrides:

```bash
node scripts/token-benchmark.mjs run \
  --execute \
  --replicates 3 \
  --max-revisions 2 \
  --worker-model gpt-5.5 \
  --reviewer-model gpt-5.4
```

Ablation example:

```bash
node scripts/token-benchmark.mjs run \
  --execute \
  --limit 1 \
  --modes baseline,entire-search-first,entire-list-first,entire-trailer-first,entire-gated
```

The script currently defaults to the local Planetfall repository paths used for
the initial experiment. Override `--source`, `--baseline-root`, `--entire-root`,
and `--runs-root` to run it somewhere else.

## Privacy

Raw child-agent JSONL logs are intentionally ignored. They can contain full
agent transcripts, local paths, and repository context. Commit summarized
results deliberately.
