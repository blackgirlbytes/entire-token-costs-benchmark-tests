# Token Benchmark Summary

Run: run-2026-06-23T18-11-07-499Z-3584e2
Worker model: gpt-5.5
Reviewer model: gpt-5.4

Note: this run used the improved Entire-arm prompt from commit `d15f942`,
which directs agents to use local `entire checkpoint explain --json --limit 100`
metadata before optional repo-scoped search. The baseline favicon replay arm
ended at `REVISE`, so this run shows both lower Entire worker tokens and a
higher accepted-result rate.

Follow-up observation: inside synthetic benchmark branches, the broad checkpoint
list can return `[]`, but targeted `entire checkpoint explain <id> --json
--no-pager` works when IDs are discovered from `Entire-Checkpoint:` git commit
trailers. The harness prompt was tightened after this run to make that fallback
explicit for future runs.

## Modes

- baseline: trials=3, pass=2, revise=1, fail=0, worker_tokens=1905634, reviewer_tokens=205480
- entire: trials=3, pass=3, revise=0, fail=0, worker_tokens=1313069, reviewer_tokens=144561

## Worker Token Delta

- baseline worker tokens: 1905634
- entire worker tokens: 1313069
- savings tokens: 592565
- savings pct: 31.10%

## Trials

- level-2-evolution baseline rep=1: verdict=PASS, worker_tokens=667709, reviewer_tokens=17640
- level-2-evolution entire rep=1: verdict=PASS, worker_tokens=454493, reviewer_tokens=62047
- level-progression-navigation baseline rep=1: verdict=PASS, worker_tokens=924014, reviewer_tokens=119345
- level-progression-navigation entire rep=1: verdict=PASS, worker_tokens=689527, reviewer_tokens=47525
- planetfall-favicon-replay entire rep=1: verdict=PASS, worker_tokens=169049, reviewer_tokens=34989
- planetfall-favicon-replay baseline rep=1: verdict=REVISE, worker_tokens=313911, reviewer_tokens=68495
