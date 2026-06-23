# Token Benchmark Summary

Run: run-2026-06-23T19-42-56-421Z-109d16
Worker model: gpt-5.5
Reviewer model: gpt-5.4

Note: this 3-replicate run reverses the prior single-run result. Both modes
passed all 9 trials, but Entire used 27.11% more worker tokens overall. The
task-level average was mixed: Level 2 evolution slightly favored Entire, while
level progression/navigation and favicon replay favored baseline. This points
to high run-to-run variance and supports running an ablation that isolates
specific Entire command strategies.

## Task Averages

- level-2-evolution: baseline avg worker=818,378; Entire avg worker=767,660
- level-progression-navigation: baseline avg worker=494,531; Entire avg worker=852,228
- planetfall-favicon-replay: baseline avg worker=254,289; Entire avg worker=372,191

## Modes

- baseline: trials=9, pass=9, revise=0, fail=0, worker_tokens=4701593, reviewer_tokens=657036
- entire: trials=9, pass=9, revise=0, fail=0, worker_tokens=5976238, reviewer_tokens=606532

## Worker Token Delta

- baseline worker tokens: 4701593
- entire worker tokens: 5976238
- savings tokens: -1274645
- savings pct: -27.11%

## Trials

- level-2-evolution baseline rep=1: verdict=PASS, worker_tokens=496252, reviewer_tokens=61587
- level-2-evolution entire rep=1: verdict=PASS, worker_tokens=734343, reviewer_tokens=66807
- level-2-evolution entire rep=2: verdict=PASS, worker_tokens=533578, reviewer_tokens=17901
- level-2-evolution baseline rep=2: verdict=PASS, worker_tokens=555897, reviewer_tokens=60132
- level-2-evolution entire rep=3: verdict=PASS, worker_tokens=1035058, reviewer_tokens=63802
- level-2-evolution baseline rep=3: verdict=PASS, worker_tokens=1402984, reviewer_tokens=53832
- level-progression-navigation baseline rep=1: verdict=PASS, worker_tokens=432404, reviewer_tokens=66885
- level-progression-navigation entire rep=1: verdict=PASS, worker_tokens=1556851, reviewer_tokens=112433
- level-progression-navigation entire rep=2: verdict=PASS, worker_tokens=376737, reviewer_tokens=52216
- level-progression-navigation baseline rep=2: verdict=PASS, worker_tokens=674645, reviewer_tokens=95554
- level-progression-navigation baseline rep=3: verdict=PASS, worker_tokens=376543, reviewer_tokens=55373
- level-progression-navigation entire rep=3: verdict=PASS, worker_tokens=623097, reviewer_tokens=52339
- planetfall-favicon-replay entire rep=1: verdict=PASS, worker_tokens=416452, reviewer_tokens=111560
- planetfall-favicon-replay baseline rep=1: verdict=PASS, worker_tokens=317069, reviewer_tokens=103118
- planetfall-favicon-replay baseline rep=2: verdict=PASS, worker_tokens=320493, reviewer_tokens=109035
- planetfall-favicon-replay entire rep=2: verdict=PASS, worker_tokens=428499, reviewer_tokens=92230
- planetfall-favicon-replay entire rep=3: verdict=PASS, worker_tokens=271623, reviewer_tokens=37244
- planetfall-favicon-replay baseline rep=3: verdict=PASS, worker_tokens=125306, reviewer_tokens=51520
