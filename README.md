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

The main metric is worker **billable cost** to accepted output (not raw token
count — see [Metrics and methodology](#metrics-and-methodology)). Reviewer token
usage is recorded separately as experiment overhead.

### What this benchmark can and cannot show

Entire's token value comes from **substitution**: recovering context from a
checkpoint *instead of* re-deriving it from source/git. A single cold session
that answers a question about current code gives Entire nothing to substitute —
it only adds a retrieval layer on top of investigation the baseline already does
cheaply, so Entire looks like pure overhead. Savings appear only when
source-rediscovery is genuinely expensive and checkpoint-retrieval replaces it:

- **Cross-session continuation** — session A checkpoints partial work; session B
  continues it. Baseline B reconstructs intent from code; Entire B reads the
  checkpoint. See [Continuation tasks](#continuation-tasks).
- **"Why / removed-behavior" questions** — the answer is no longer in source, so
  baseline must crawl full diff history while Entire reads one checkpoint. See
  `benchmarks/token-cost/tasks-history.json`.

The default `tasks.json` set is the *worst case* for showing savings; treat its
results as a methodology sanity check, not the headline.

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
  --reviewer-model gpt-5.4 \
  --pricing ./pricing.json
```

`pricing.json` sets real per-model rates for the billable-cost metric, e.g.:

```json
{
  "reasoningInOutput": true,
  "models": {
    "gpt-5.5": { "input": 1.25, "cachedInput": 0.125, "output": 10.0 }
  }
}
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

## Metrics and methodology

The summarizer (`summarize` / end of `run`) reports cost-weighted, paired,
per-token-class results rather than a single summed token percentage:

- **Billable cost, not raw tokens.** Raw `total_tokens` mixes cheap cache-read
  input, full-price fresh input, and output at equal weight. The Entire arm
  inflates *input* tokens (skill file + checkpoint JSON), but cache-read input
  is ~10x cheaper to bill, so a token-count delta does not match the dollar
  delta. Costs use a per-model pricing table — override the placeholders with
  `--pricing <path-or-json>` or `BENCH_PRICING_JSON` before trusting the numbers.
- **Per-token-class breakdown.** Each mode reports fresh-input / cached-input /
  output / reasoning separately so you can see *where* an arm spends.
- **Per-task paired deltas, aggregated by geometric mean.** A summed grand-total
  percentage is dominated by whichever single task is most expensive — that is
  how the earlier headline flipped between runs. Each (task, rep) Entire trial is
  paired with its baseline trial; the per-pair cost ratio is aggregated with a
  geometric mean (and median). `cost_ratio < 1` / positive `cost_savings%` means
  Entire is cheaper. Per-task rows show which tasks help and which hurt.
- **Fixed vs marginal Entire cost.** Every trial reports
  `entire_marginal~` — an approximate count of tokens the worker ingested from
  Entire-specific command output and skill-file reads (heuristic JSONL scan).
  This separates Entire-attributable spend from the shared task investigation
  both arms do. The `entire-overhead-probe` task isolates the *fixed* overhead
  (skill load + `entire status`) on a question that needs no history.

## Continuation tasks

A continuation task declares a `seed` (session A). The harness runs the seed
prompt in the Entire-enabled root, commits the partial work so the commit
carries an `Entire-Checkpoint` trailer, publishes the seed commit + checkpoint
metadata, and then both arms continue from that seed commit — only the Entire
arm can read the prior session's checkpoint.

```bash
# Seed once, capture the base SHA:
node scripts/token-benchmark.mjs seed --task continue-partial-feature --execute

# Then run both arms from the seed:
node scripts/token-benchmark.mjs run --execute --include-drafts \
  --manifest benchmarks/token-cost/tasks-history.json \
  --task continue-partial-feature --seed-base <sha>
```

History-dependent and continuation task templates live in
`benchmarks/token-cost/tasks-history.json` and are marked `"draft": true` (fill
in the repo-specific `<BEHAVIOR>` / `<FEATURE>` / `base` placeholders, then run
with `--include-drafts`).

## Privacy

Raw child-agent JSONL logs are intentionally ignored. They can contain full
agent transcripts, local paths, and repository context. Commit summarized
results deliberately.
