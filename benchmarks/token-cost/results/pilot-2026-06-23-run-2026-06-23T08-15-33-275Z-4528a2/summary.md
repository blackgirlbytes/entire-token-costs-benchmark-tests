# Token Benchmark Summary

Run: `run-2026-06-23T08-15-33-275Z-4528a2`

Worker model: `gpt-5.5`

Reviewer model: `gpt-5.4`

## Caveat

This pilot was launched before the benchmark setup rewrote cloned benchmark
roots back to the real GitHub `origin` URL. The child agents reported that
`entire checkpoint search --json` was blocked or returned no useful indexed
results in this local-clone setup, so this run should be treated as a valid
pilot of the loop mechanics, not a final estimate of Entire-assisted
performance.

After this run, `scripts/token-benchmark.mjs setup` was fixed so benchmark
roots keep the source repository's upstream `origin` URL.

## Modes

- baseline: trials=3, pass=3, revise=0, fail=0, worker_tokens=1271165, reviewer_tokens=248418
- entire: trials=3, pass=3, revise=0, fail=0, worker_tokens=1820535, reviewer_tokens=164361

## Worker Token Delta

- baseline worker tokens: 1271165
- entire worker tokens: 1820535
- savings tokens: -549370
- savings pct: -43.22%

## Trials

- level-2-evolution baseline rep=1: verdict=PASS, worker_tokens=511045, reviewer_tokens=57829
- level-2-evolution entire rep=1: verdict=PASS, worker_tokens=866864, reviewer_tokens=16158
- level-progression-navigation baseline rep=1: verdict=PASS, worker_tokens=391743, reviewer_tokens=102550
- level-progression-navigation entire rep=1: verdict=PASS, worker_tokens=790288, reviewer_tokens=110953
- planetfall-favicon-replay entire rep=1: verdict=PASS, worker_tokens=163383, reviewer_tokens=37250
- planetfall-favicon-replay baseline rep=1: verdict=PASS, worker_tokens=368377, reviewer_tokens=88039
