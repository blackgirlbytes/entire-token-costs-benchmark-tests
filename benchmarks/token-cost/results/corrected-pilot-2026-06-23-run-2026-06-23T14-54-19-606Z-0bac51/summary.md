# Token Benchmark Summary

Run: run-2026-06-23T14-54-19-606Z-0bac51
Worker model: gpt-5.5
Reviewer model: gpt-5.4

## Notes

This rerun used benchmark roots whose `origin` remotes were rewritten to the
real GitHub repository URL before launching child agents. `entire checkpoint
search --json` ran without the local-remote parsing failure seen in the first
pilot, but returned zero indexed results for the tested Planetfall queries, so
the Entire arm mostly used local checkpoint trailers and `entire checkpoint
explain`.

## Modes

- entire: trials=3, pass=3, revise=0, fail=0, worker_tokens=1783912, reviewer_tokens=202506
- baseline: trials=3, pass=3, revise=0, fail=0, worker_tokens=1262088, reviewer_tokens=218635

## Worker Token Delta

- baseline worker tokens: 1262088
- entire worker tokens: 1783912
- savings tokens: -521824
- savings pct: -41.35%

## Trials

- level-2-evolution entire rep=1: verdict=PASS, worker_tokens=803267, reviewer_tokens=17745
- level-2-evolution baseline rep=1: verdict=PASS, worker_tokens=621469, reviewer_tokens=17731
- level-progression-navigation entire rep=1: verdict=PASS, worker_tokens=643991, reviewer_tokens=113247
- level-progression-navigation baseline rep=1: verdict=PASS, worker_tokens=352452, reviewer_tokens=88950
- planetfall-favicon-replay entire rep=1: verdict=PASS, worker_tokens=336654, reviewer_tokens=71514
- planetfall-favicon-replay baseline rep=1: verdict=PASS, worker_tokens=288167, reviewer_tokens=111954
