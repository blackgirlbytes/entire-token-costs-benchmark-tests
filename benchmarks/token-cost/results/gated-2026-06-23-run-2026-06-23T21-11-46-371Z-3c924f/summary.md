# Token Benchmark Summary

Run: run-2026-06-23T21-11-46-371Z-3c924f
Worker model: gpt-5.5
Reviewer model: gpt-5.4

## Modes

- entire-gated: trials=3, pass=3, revise=0, fail=0, worker_tokens=1433363, reviewer_tokens=208371
- baseline: trials=3, pass=3, revise=0, fail=0, worker_tokens=1063608, reviewer_tokens=162294

## Trials

- level-2-evolution entire-gated rep=1: verdict=PASS, worker_tokens=460817, reviewer_tokens=59988
- level-2-evolution baseline rep=1: verdict=PASS, worker_tokens=447243, reviewer_tokens=17131
- level-progression-navigation baseline rep=1: verdict=PASS, worker_tokens=397865, reviewer_tokens=86205
- level-progression-navigation entire-gated rep=1: verdict=PASS, worker_tokens=657566, reviewer_tokens=90634
- planetfall-favicon-replay baseline rep=1: verdict=PASS, worker_tokens=218500, reviewer_tokens=58958
- planetfall-favicon-replay entire-gated rep=1: verdict=PASS, worker_tokens=314980, reviewer_tokens=57749

## Analysis

This run tested `entire-gated`, a prompt mode that limits Entire to a small
probe: `entire status`, one git-trailer lookup, and at most two targeted
checkpoint explains before falling back to normal source/git inspection.

All trials passed, but `entire-gated` still used 34.77% more worker tokens than
baseline overall:

- level-2-evolution: 460,817 vs 447,243 (+3.04%).
- level-progression-navigation: 657,566 vs 397,865 (+65.27%).
- planetfall-favicon-replay: 314,980 vs 218,500 (+44.16%).

Local command-log inspection showed that the gate worked mechanically: gated
trials ran no broad `entire checkpoint search` or broad checkpoint list calls.
They used 2-4 Entire commands each, with one git-trailer probe and 1-2 targeted
`entire checkpoint explain` calls. However, each gated worker also loaded the
`using-entire` skill file and then performed substantial normal source/git
inspection:

| task | mode | worker tokens | commands | Entire commands | checkpoint explains/searches | skill reads | git-trailer probes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| level-2-evolution | entire-gated | 460,817 | 25 | 4 | 2 | 1 | 1 |
| level-2-evolution | baseline | 447,243 | 27 | 0 | 0 | 0 | 0 |
| level-progression-navigation | baseline | 397,865 | 14 | 0 | 0 | 0 | 0 |
| level-progression-navigation | entire-gated | 657,566 | 30 | 4 | 2 | 1 | 1 |
| planetfall-favicon-replay | baseline | 218,500 | 9 | 0 | 0 | 0 | 0 |
| planetfall-favicon-replay | entire-gated | 314,980 | 16 | 2 | 1 | 1 | 1 |

Interpretation: gating reduced Entire over-exploration compared with earlier
ungated/list-heavy strategies, but it did not make Entire cheaper than baseline
on this task set. The remaining overhead appears to come from duplicated
context: the worker reads Entire instructions/history, then still reads enough
source and git state to solve the task independently. The next ablation should
test a more radical mode that either provides precomputed checkpoint snippets
to the worker or forbids loading local Entire skill files inside child trials.
