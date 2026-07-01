# Token Benchmark Summary

Run: run-2026-07-01T16-16-38-410Z-da5402
Worker model: gpt-5.5
Reviewer model: gpt-5.4

## Modes

- entire-search-first: trials=3, pass=3, revise=0, fail=0, worker_tokens=2290286, reviewer_tokens=253565
- baseline: trials=3, pass=3, revise=0, fail=0, worker_tokens=1151083, reviewer_tokens=158345
- entire: trials=3, pass=3, revise=0, fail=0, worker_tokens=1478916, reviewer_tokens=202507

## Worker Token Delta

- baseline worker tokens: 1151083
- entire worker tokens: 1478916
- savings tokens: -327833
- savings pct: -28.48%

## Trials

- level-2-evolution entire-search-first rep=1: verdict=PASS, worker_tokens=966531, reviewer_tokens=69167
- level-2-evolution baseline rep=1: verdict=PASS, worker_tokens=454536, reviewer_tokens=42712
- level-2-evolution entire rep=1: verdict=PASS, worker_tokens=753670, reviewer_tokens=70200
- level-progression-navigation entire-search-first rep=1: verdict=PASS, worker_tokens=778512, reviewer_tokens=89151
- level-progression-navigation entire rep=1: verdict=PASS, worker_tokens=409620, reviewer_tokens=96951
- level-progression-navigation baseline rep=1: verdict=PASS, worker_tokens=531976, reviewer_tokens=80262
- planetfall-favicon-replay entire rep=1: verdict=PASS, worker_tokens=315626, reviewer_tokens=35356
- planetfall-favicon-replay entire-search-first rep=1: verdict=PASS, worker_tokens=545243, reviewer_tokens=95247
- planetfall-favicon-replay baseline rep=1: verdict=PASS, worker_tokens=164571, reviewer_tokens=35371

## Analysis

This rerun happened after Entire search began returning useful Planetfall
results again. A direct probe before the benchmark returned 68 results for
`Level 2`, including checkpoints, sessions, commits, and PRs.

All modes passed all trials. Search correctness is no longer the blocker, but
search-first is still not token-cheap in this prompt shape:

- `entire`: 1,478,916 worker tokens vs baseline 1,151,083 (+28.48%).
- `entire-search-first`: 2,290,286 worker tokens vs baseline 1,151,083 (+98.97%).

Per-task worker token deltas against baseline:

| task | entire delta | entire-search-first delta |
| --- | ---: | ---: |
| level-2-evolution | +299,134 (+65.81%) | +511,995 (+112.64%) |
| level-progression-navigation | -122,356 (-23.00%) | +246,536 (+46.34%) |
| planetfall-favicon-replay | +151,055 (+91.79%) | +380,672 (+231.31%) |

Local command-log inspection showed search-first really exercised the repaired
search path:

| task | mode | commands | Entire commands | search commands | explain commands | skill reads |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| level-2-evolution | entire-search-first | 41 | 12 | 7 | 4 | 2 |
| level-progression-navigation | entire-search-first | 37 | 5 | 2 | 2 | 1 |
| planetfall-favicon-replay | entire-search-first | 19 | 4 | 2 | 1 | 1 |

Interpretation: the search backend fix changes the failure mode from "search
returns nothing or times out" to "search returns enough that the worker keeps
researching." The next useful ablation should cap search result handling: one
query, top 1-2 results, at most one targeted explain, and no local skill-file
loading inside the child trial.
