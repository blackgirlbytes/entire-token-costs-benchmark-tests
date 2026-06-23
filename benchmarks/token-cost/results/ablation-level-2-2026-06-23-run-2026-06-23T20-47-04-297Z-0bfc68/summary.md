# Token Benchmark Summary

Run: run-2026-06-23T20-47-04-297Z-0bfc68
Worker model: gpt-5.5
Reviewer model: gpt-5.4

Note: this one-replicate ablation covered only `level-2-evolution`. All modes
passed. Baseline was cheapest, while `entire-search-first` was the cheapest
Entire strategy in this run. The command traces suggest the prompt strategy did
affect behavior, but not enough to beat baseline for this replicate.

## Command Trace Counts

- entire-trailer-first: 42 commands; 18 Entire commands; 0 search; 17 checkpoint/explain calls
- entire-search-first: 39 commands; 13 Entire commands; 5 search; 6 checkpoint/explain calls
- entire-list-first: 53 commands; 17 Entire commands; 2 search; 13 checkpoint/explain calls
- baseline: 17 commands; 0 Entire commands

## Modes

- entire-trailer-first: trials=1, pass=1, revise=0, fail=0, worker_tokens=664515, reviewer_tokens=41586
- entire-search-first: trials=1, pass=1, revise=0, fail=0, worker_tokens=483793, reviewer_tokens=16301
- entire-list-first: trials=1, pass=1, revise=0, fail=0, worker_tokens=663152, reviewer_tokens=36763
- baseline: trials=1, pass=1, revise=0, fail=0, worker_tokens=265387, reviewer_tokens=17831

## Trials

- level-2-evolution entire-trailer-first rep=1: verdict=PASS, worker_tokens=664515, reviewer_tokens=41586
- level-2-evolution entire-search-first rep=1: verdict=PASS, worker_tokens=483793, reviewer_tokens=16301
- level-2-evolution entire-list-first rep=1: verdict=PASS, worker_tokens=663152, reviewer_tokens=36763
- level-2-evolution baseline rep=1: verdict=PASS, worker_tokens=265387, reviewer_tokens=17831
