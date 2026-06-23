# Entire Search vs Explain Diagnostic

Date: 2026-06-23

## Question

The corrected pilot still showed the Entire arm using more worker tokens. One suspected cause was that the user might not be logged into Entire, causing `entire checkpoint search` to fail or return no useful context.

## Findings

- Auth is not the issue. `entire auth status` shows the user is logged in as `@blackgirlbytes` against `https://us.auth.entire.io`.
- Repo-scoped search for `blackgirlbytes/planetfall-seed-signalkit` is not useful right now:
  - In the benchmark clone, `entire checkpoint search --json "level 2" --limit 5` returned zero results.
  - In the benchmark clone, `entire checkpoint search --json --repo blackgirlbytes/planetfall-seed-signalkit "level 2" --limit 5` returned zero results.
  - In the original repo, repo-scoped `level 2` search timed out against `https://entire.io/search/v1/search`.
- Global search works in general, but it returns unrelated repos for this query, not Planetfall.
- Local checkpoint metadata works in both the original repo and the benchmark clone:
  - `entire checkpoint explain --json --limit 100` returns Planetfall checkpoints.
  - Known useful Level 2 checkpoint IDs include `b7dd9d7616ea`, `84da75cf4015`, `3500b4613672`, `09cb2aeecea3`, `8eda3033e7b0`, `b305aa54b583`, and `e16fc6356f0f`.
  - `entire checkpoint explain b7dd9d7616ea --json --no-pager` works in the benchmark clone and returns session/file/token metadata.

## Harness Change

The Entire worker prompt now instructs the agent to use local checkpoint metadata first:

1. Run `entire status`.
2. Run `entire checkpoint explain --json --limit 100`.
3. Filter the local checkpoint list for relevant checkpoint IDs.
4. Inspect targeted IDs with `entire checkpoint explain <id> --json --no-pager`.
5. Treat `entire checkpoint search --json` as optional, and continue if it returns empty or times out.

This avoids measuring the search-index miss as though it were an inherent Entire-token-cost result.

## Recommendation

Run the next benchmark only after this harness prompt change. The next run will better test whether local Entire checkpoint metadata reduces rediscovery compared with baseline source/git inspection.
