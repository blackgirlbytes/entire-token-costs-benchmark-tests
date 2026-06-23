#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULTS = {
  source: "/Users/goose-guest/Documents/work/planetfall-seed-signalkit",
  baselineRoot: "/Users/goose-guest/Documents/work/planetfall-bench-baseline",
  entireRoot: "/Users/goose-guest/Documents/work/planetfall-bench-entire",
  runsRoot: "/Users/goose-guest/Documents/work/planetfall-bench-runs",
  manifest: "benchmarks/token-cost/tasks.json",
  workerModel: process.env.BENCH_WORKER_MODEL || "gpt-5.5",
  reviewerModel: process.env.BENCH_REVIEWER_MODEL || "gpt-5.4",
  replicates: 1,
  maxRevisions: 1,
  limit: 3,
  modes: "baseline,entire",
  pricing: process.env.BENCH_PRICING_JSON || "",
  includeDrafts: false,
  seedBase: "",
  task: "",
};

// Per-million-token USD pricing used to convert raw token counts into a
// billable-cost estimate. Raw `total_tokens` is the WRONG comparison unit
// between arms: the Entire arm inflates *input* tokens (skill file + checkpoint
// JSON), but cache-read input is ~10x cheaper to bill, so a token-count delta
// does not match the dollar delta. Cost weighting is what the headline should
// report.
//
// IMPORTANT: these are placeholders. Override with your real model prices via
// `--pricing <path-or-json>` or BENCH_PRICING_JSON before trusting cost output.
// `cachedInput` is the discounted rate charged for cache-read input tokens.
// `output` covers completion tokens; set `reasoningInOutput:false` for a model
// whose usage reports reasoning tokens *outside* output_tokens.
const DEFAULT_PRICING = {
  reasoningInOutput: true,
  models: {
    "gpt-5.5": { input: 1.25, cachedInput: 0.125, output: 10.0 },
    "gpt-5.4": { input: 1.25, cachedInput: 0.125, output: 10.0 },
    default: { input: 1.0, cachedInput: 0.1, output: 8.0 },
  },
};

function loadPricing(value) {
  if (!value) {
    return DEFAULT_PRICING;
  }
  let raw = value;
  if (!value.trim().startsWith("{")) {
    raw = fs.readFileSync(value, "utf8");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`--pricing must be a JSON object or path to one: ${error.message}`);
  }
  const models = parsed.models || parsed;
  return {
    reasoningInOutput:
      parsed.reasoningInOutput === undefined ? true : Boolean(parsed.reasoningInOutput),
    models: { ...DEFAULT_PRICING.models, ...models },
  };
}

function modelRate(pricing, model) {
  return pricing.models[model] || pricing.models.default || DEFAULT_PRICING.models.default;
}

// costForUsage converts a usage record into a billable USD estimate, charging
// cache-read input at the discounted rate and fresh input at the full rate.
function costForUsage(usage, model, pricing) {
  if (!usage) {
    return 0;
  }
  const rate = modelRate(pricing, model);
  const cached = usage.cached_input_tokens || 0;
  const freshInput = Math.max((usage.input_tokens || 0) - cached, 0);
  const reasoning = usage.reasoning_output_tokens || 0;
  const output = (usage.output_tokens || 0) + (pricing.reasoningInOutput ? 0 : reasoning);
  return (
    (freshInput * rate.input + cached * rate.cachedInput + output * rate.output) / 1_000_000
  );
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

const MODE_CONFIGS = {
  baseline: {
    rootKind: "baseline",
    instructions: [
      "You are in the baseline arm of a benchmark.",
      "Do not use Entire CLI, Entire checkpoint history, or `entire` commands. Use normal source inspection, git history, tests, and reasoning.",
    ],
  },
  entire: {
    rootKind: "entire",
    instructions: [
      "You are in the Entire-assisted arm of a benchmark.",
      "Use Entire CLI strategically when it helps reduce rediscovery. Start with `entire status`.",
      "For historical questions, start from local checkpoint metadata: run `entire checkpoint explain --json --limit 100`, filter the JSON/messages for relevant checkpoint IDs, then inspect targeted IDs with `entire checkpoint explain <id> --json --no-pager`.",
      "If the broad checkpoint list is empty on a synthetic benchmark branch, use git commit trailers to discover IDs, for example `git log --all --format='%H %s%n%b' -- <relevant files>` and look for `Entire-Checkpoint:` before running targeted `entire checkpoint explain <id> --json --no-pager`.",
      "Use `entire checkpoint search --json` only as an optional secondary source. If repo-scoped search returns empty or times out, record that briefly and continue with local checkpoint, code, and git evidence.",
    ],
  },
  "entire-search-first": {
    rootKind: "entire",
    instructions: [
      "You are in the Entire search-first ablation arm of a benchmark.",
      "Use Entire CLI strategically when it helps reduce rediscovery. Start with `entire status`.",
      "For historical questions, try targeted `entire checkpoint search --json` queries first, then inspect promising checkpoint IDs with `entire checkpoint explain <id> --json --no-pager`.",
      "If repo-scoped search returns empty or times out, record that briefly and continue with normal source and git evidence.",
    ],
  },
  "entire-list-first": {
    rootKind: "entire",
    instructions: [
      "You are in the Entire checkpoint-list-first ablation arm of a benchmark.",
      "Use Entire CLI strategically when it helps reduce rediscovery. Start with `entire status`.",
      "For historical questions, start from local checkpoint metadata: run `entire checkpoint explain --json --limit 100`, filter the JSON/messages for relevant checkpoint IDs, then inspect targeted IDs with `entire checkpoint explain <id> --json --no-pager`.",
      "Use `entire checkpoint search --json` only as an optional secondary source. If repo-scoped search returns empty or times out, record that briefly and continue with local checkpoint, code, and git evidence.",
    ],
  },
  "entire-trailer-first": {
    rootKind: "entire",
    instructions: [
      "You are in the Entire git-trailer-first ablation arm of a benchmark.",
      "Use Entire CLI strategically when it helps reduce rediscovery. Start with `entire status`.",
      "For historical questions, identify relevant files, then use git commit trailers to discover checkpoint IDs, for example `git log --all --format='%H %s%n%b' -- <relevant files>` and look for `Entire-Checkpoint:`.",
      "Inspect only the most relevant IDs with `entire checkpoint explain <id> --json --no-pager`, then combine that evidence with focused source inspection.",
      "Avoid broad `entire checkpoint search --json` unless git trailers do not reveal useful checkpoint IDs.",
    ],
  },
  "entire-gated": {
    rootKind: "entire",
    instructions: [
      "You are in the Entire gated ablation arm of a benchmark.",
      "Use Entire only as a small evidence probe, not as a second research project. Start with `entire status`.",
      "For history or intent questions, identify 1-3 relevant files, then run one git trailer command such as `git log --all --format='%H %s%n%b' -- <relevant files>` and look for `Entire-Checkpoint:`.",
      "If you find a clearly relevant checkpoint ID, inspect at most two IDs with `entire checkpoint explain <id> --json --no-pager`.",
      "Do not run broad checkpoint search or list commands unless the task cannot be answered otherwise. If the initial probe has no useful signal after 3 commands, stop using Entire and continue with normal source, git, and test evidence.",
    ],
  },
};

const usage = `Usage:
  node scripts/token-benchmark.mjs setup [options]
  node scripts/token-benchmark.mjs seed --task <id> [--dry-run|--execute] [options]
  node scripts/token-benchmark.mjs run [--dry-run|--execute] [options]
  node scripts/token-benchmark.mjs summarize --run-dir <path>

Options:
  --source <path>          Source repository to clone from.
  --baseline-root <path>   No-Entire benchmark clone.
  --entire-root <path>     Entire-enabled benchmark clone.
  --runs-root <path>       Directory for trial worktrees and logs.
  --manifest <path>        Task manifest JSON.
  --worker-model <slug>    Codex worker model. Default: ${DEFAULTS.workerModel}
  --reviewer-model <slug>  Codex reviewer model. Default: ${DEFAULTS.reviewerModel}
  --replicates <n>         Replicates per task. Default: ${DEFAULTS.replicates}
  --max-revisions <n>      Worker revision passes after review feedback. Default: ${DEFAULTS.maxRevisions}
  --limit <n>              Max tasks from manifest. Default: ${DEFAULTS.limit}
  --modes <csv>            Comma-separated benchmark modes. Default: ${DEFAULTS.modes}
                           Available: ${Object.keys(MODE_CONFIGS).join(", ")}
  --pricing <path|json>    Per-model USD pricing for the billable-cost metric.
                           JSON object or path to one. See DEFAULT_PRICING.
  --task <id>              Task ID (required for 'seed'; optional filter for 'run').
  --seed-base <sha>        Pre-seeded continuation base commit; skips auto-seed.
  --include-drafts         Include tasks marked "draft": true in the manifest.
  --execute                Actually launch Codex child sessions.
  --dry-run                Print the planned trials without launching agents.
`;

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  const opts = {
    ...DEFAULTS,
    command,
    execute: false,
    dryRun: false,
    runDir: "",
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = () => {
      i += 1;
      if (i >= args.length) {
        throw new Error(`Missing value for ${arg}`);
      }
      return args[i];
    };

    switch (arg) {
      case "--source":
        opts.source = next();
        break;
      case "--baseline-root":
        opts.baselineRoot = next();
        break;
      case "--entire-root":
        opts.entireRoot = next();
        break;
      case "--runs-root":
        opts.runsRoot = next();
        break;
      case "--manifest":
        opts.manifest = next();
        break;
      case "--worker-model":
        opts.workerModel = next();
        break;
      case "--reviewer-model":
        opts.reviewerModel = next();
        break;
      case "--replicates":
        opts.replicates = Number.parseInt(next(), 10);
        break;
      case "--max-revisions":
        opts.maxRevisions = Number.parseInt(next(), 10);
        break;
      case "--limit":
        opts.limit = Number.parseInt(next(), 10);
        break;
      case "--modes":
        opts.modes = next();
        break;
      case "--pricing":
        opts.pricing = next();
        break;
      case "--seed-base":
        opts.seedBase = next();
        break;
      case "--task":
        opts.task = next();
        break;
      case "--include-drafts":
        opts.includeDrafts = true;
        break;
      case "--run-dir":
        opts.runDir = next();
        break;
      case "--execute":
        opts.execute = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "-h":
      case "--help":
        console.log(usage);
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!command || !["setup", "run", "summarize", "seed"].includes(command)) {
    throw new Error(`Unknown or missing command.\n\n${usage}`);
  }
  if (opts.execute && opts.dryRun) {
    throw new Error("Choose only one of --execute or --dry-run.");
  }
  if (!opts.execute && opts.command === "run") {
    opts.dryRun = true;
  }
  if (!Number.isInteger(opts.replicates) || opts.replicates < 1) {
    throw new Error("--replicates must be a positive integer.");
  }
  if (!Number.isInteger(opts.maxRevisions) || opts.maxRevisions < 0) {
    throw new Error("--max-revisions must be zero or greater.");
  }
  if (!Number.isInteger(opts.limit) || opts.limit < 1) {
    throw new Error("--limit must be a positive integer.");
  }
  opts.modes = parseModes(opts.modes);
  opts.pricing = loadPricing(opts.pricing);

  return opts;
}

function parseModes(value) {
  const modes = String(value)
    .split(",")
    .map((mode) => mode.trim())
    .filter(Boolean);
  if (!modes.length) {
    throw new Error("--modes must include at least one mode.");
  }
  for (const mode of modes) {
    if (!MODE_CONFIGS[mode]) {
      throw new Error(`Unknown mode: ${mode}. Available modes: ${Object.keys(MODE_CONFIGS).join(", ")}`);
    }
  }
  return modes;
}

function run(cmd, args, options = {}) {
  const pretty = [cmd, ...args].join(" ");
  if (options.dryRun) {
    console.log(`[dry-run] ${pretty}`);
    return { status: 0, stdout: "", stderr: "" };
  }

  const result = spawnSync(cmd, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    shell: false,
    timeout: options.timeoutMs,
    maxBuffer: options.maxBuffer || 50 * 1024 * 1024,
  });

  if (result.error && result.error.code !== "ETIMEDOUT") {
    throw result.error;
  }

  const status = result.status ?? 1;
  if (options.logFile) {
    fs.mkdirSync(path.dirname(options.logFile), { recursive: true });
    fs.writeFileSync(
      options.logFile,
      [
        `$ ${pretty}`,
        "",
        "## stdout",
        result.stdout || "",
        "",
        "## stderr",
        result.stderr || "",
        "",
        `status=${status}`,
      ].join("\n"),
    );
  }

  if (options.check !== false && status !== 0) {
    throw new Error(`Command failed (${status}): ${pretty}\n${result.stderr || result.stdout}`);
  }

  return {
    status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    timedOut: result.error?.code === "ETIMEDOUT",
  };
}

function runShell(command, options = {}) {
  if (options.dryRun) {
    console.log(`[dry-run] ${command}`);
    return { status: 0, stdout: "", stderr: "" };
  }

  const result = spawnSync(command, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    shell: true,
    timeout: options.timeoutMs,
    maxBuffer: options.maxBuffer || 50 * 1024 * 1024,
  });
  const status = result.status ?? 1;

  if (options.logFile) {
    fs.mkdirSync(path.dirname(options.logFile), { recursive: true });
    fs.writeFileSync(
      options.logFile,
      [
        `$ ${command}`,
        "",
        "## stdout",
        result.stdout || "",
        "",
        "## stderr",
        result.stderr || "",
        "",
        `status=${status}`,
      ].join("\n"),
    );
  }

  if (options.check !== false && status !== 0) {
    throw new Error(`Command failed (${status}): ${command}\n${result.stderr || result.stdout}`);
  }

  return {
    status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    timedOut: result.error?.code === "ETIMEDOUT",
  };
}

function repoRoot() {
  return run("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd() }).stdout.trim();
}

function resolveFromRepo(value) {
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.join(repoRoot(), value);
}

function cloneOrUpdate(source, dest, dryRun) {
  if (!fs.existsSync(dest)) {
    run("git", ["clone", source, dest], { dryRun });
    return;
  }

  if (!fs.existsSync(path.join(dest, ".git"))) {
    throw new Error(`${dest} exists but is not a Git clone.`);
  }

  run("git", ["fetch", "--all", "--tags"], { cwd: dest, dryRun });
}

function setup(opts) {
  cloneOrUpdate(opts.source, opts.baselineRoot, opts.dryRun);
  cloneOrUpdate(opts.source, opts.entireRoot, opts.dryRun);
  alignOriginWithSource(opts.source, opts.baselineRoot, opts.dryRun);
  alignOriginWithSource(opts.source, opts.entireRoot, opts.dryRun);

  run("entire", ["disable", "--force"], {
    cwd: opts.baselineRoot,
    dryRun: opts.dryRun,
    check: false,
  });

  run("entire", ["agent", "add", "codex", "--force"], {
    cwd: opts.entireRoot,
    dryRun: opts.dryRun,
    check: false,
  });

  console.log(`Baseline root: ${opts.baselineRoot}`);
  console.log(`Entire root:   ${opts.entireRoot}`);
}

function alignOriginWithSource(source, dest, dryRun) {
  const sourceOrigin = run("git", ["config", "--get", "remote.origin.url"], {
    cwd: source,
    check: false,
    dryRun,
  }).stdout.trim();
  if (!sourceOrigin || sourceOrigin === source) {
    return;
  }
  run("git", ["remote", "set-url", "origin", sourceOrigin], { cwd: dest, dryRun });
  run("git", ["fetch", "origin", "--tags"], { cwd: dest, dryRun });
}

function readTasks(manifestPath, limit, opts = {}) {
  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error("Task manifest must be a JSON array.");
  }
  let tasks = parsed;
  // Draft tasks (e.g. history-dependent templates awaiting repo-specific
  // commit hashes) are skipped unless explicitly included, so the default
  // run never trips over a placeholder `base`.
  if (!opts.includeDrafts) {
    tasks = tasks.filter((task) => !task.draft);
  }
  if (opts.task) {
    tasks = tasks.filter((task) => task.id === opts.task);
    if (!tasks.length) {
      throw new Error(`No task with id "${opts.task}" in ${manifestPath}.`);
    }
  }
  return tasks.slice(0, limit);
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function slugPart(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "");
}

function appendExclude(trialDir) {
  const exclude = run("git", ["rev-parse", "--git-path", "info/exclude"], {
    cwd: trialDir,
  }).stdout.trim();
  const additions = [
    "",
    "# token benchmark scaffolding",
    ".bench/",
    ".codex/",
    ".agents/",
    ".entire/settings.local.json",
    "node_modules/",
    "dist/",
  ].join("\n");
  fs.appendFileSync(exclude, `${additions}\n`);
}

function createEntireShim(trialDir) {
  const binDir = path.join(trialDir, ".bench", "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const shim = path.join(binDir, "entire");
  fs.writeFileSync(
    shim,
    [
      "#!/usr/bin/env bash",
      "echo 'Entire CLI is disabled in baseline benchmark mode.' >&2",
      "exit 127",
      "",
    ].join("\n"),
  );
  fs.chmodSync(shim, 0o755);
  return binDir;
}

function prepareTrial(root, trialDir, task, mode, branch, dryRun) {
  const modeConfig = MODE_CONFIGS[mode];
  fs.mkdirSync(path.dirname(trialDir), { recursive: true });
  run("git", ["worktree", "add", "-B", branch, trialDir, task.base], {
    cwd: root,
    dryRun,
  });
  if (dryRun) {
    return { env: process.env };
  }

  appendExclude(trialDir);
  fs.mkdirSync(path.join(trialDir, ".bench"), { recursive: true });

  if (modeConfig.rootKind === "baseline") {
    run("entire", ["disable", "--force"], {
      cwd: trialDir,
      check: false,
    });
    const shimDir = createEntireShim(trialDir);
    return {
      env: {
        ...process.env,
        PATH: `${shimDir}${path.delimiter}${process.env.PATH}`,
        BENCH_MODE: mode,
      },
    };
  }

  run("entire", ["agent", "add", "codex", "--force"], {
    cwd: trialDir,
    check: false,
  });
  return {
    env: {
      ...process.env,
      BENCH_MODE: mode,
    },
  };
}

function maybeInstallDependencies(trialDir, benchDir, task, env) {
  if (!task.installDependencies) {
    return { status: 0, skipped: true };
  }
  return runShell("npm ci --prefer-offline --no-audit --fund=false", {
    cwd: trialDir,
    env,
    check: false,
    timeoutMs: 5 * 60 * 1000,
    logFile: path.join(benchDir, "npm-ci.log"),
  });
}

function criteriaText(task) {
  return task.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n");
}

function buildWorkerPrompt(task, mode, revision, feedbackPath) {
  const modeInstructions = MODE_CONFIGS[mode].instructions;

  const revisionInstructions =
    revision === 0
      ? []
      : [
          "This is a revision pass after blind review feedback.",
          `Read the feedback at ${feedbackPath} and address it directly.`,
        ];

  return [
    "# Benchmark Task",
    "",
    `Task ID: ${task.id}`,
    `Task kind: ${task.kind}`,
    "",
    "## Prompt",
    "",
    task.prompt,
    "",
    "## Acceptance Criteria",
    "",
    criteriaText(task),
    "",
    "## Mode Instructions",
    "",
    ...modeInstructions,
    "",
    "## Work Rules",
    "",
    "- Do not commit, push, or create a pull request.",
    "- Keep edits narrow and task-focused.",
    "- Run the most relevant checks yourself when useful.",
    "- In your final response, summarize the work and mention any checks run.",
    "",
    ...revisionInstructions,
    "",
  ].join("\n");
}

function buildReviewerPrompt(task, artifacts) {
  return [
    "# Blind Benchmark Review",
    "",
    "Review the work against the task and acceptance criteria. Ignore how the work was produced.",
    "Return exactly one JSON object with this shape:",
    "",
    '{"verdict":"PASS|REVISE|FAIL","feedback":"short actionable feedback","confidence":0.0}',
    "",
    "Use PASS only if the output is useful and satisfies the criteria. Use REVISE for fixable gaps. Use FAIL for fundamentally wrong or missing work.",
    "",
    "## Task",
    "",
    task.prompt,
    "",
    "## Acceptance Criteria",
    "",
    criteriaText(task),
    "",
    "## Worker Final Message",
    "",
    artifacts.finalMessage || "(empty)",
    "",
    "## Git Diff",
    "",
    truncate(artifacts.diff || "(no diff)", 60000),
    "",
    "## Check Results",
    "",
    artifacts.checkSummary || "(no checks configured)",
    "",
  ].join("\n");
}

function truncate(value, max) {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}\n\n[truncated ${value.length - max} bytes]`;
}

function codexExec({ trialDir, model, promptPath, jsonlPath, lastMessagePath, env, sandbox }) {
  fs.mkdirSync(path.dirname(jsonlPath), { recursive: true });
  const stderrPath = jsonlPath.replace(/\.jsonl$/, ".stderr.log");

  const command = [
    "codex",
    "exec",
    "--cd",
    shellQuote(trialDir),
    "--model",
    shellQuote(model),
    "--sandbox",
    shellQuote(sandbox),
    "--json",
    "--output-last-message",
    shellQuote(lastMessagePath),
    "-",
    "<",
    shellQuote(promptPath),
    ">",
    shellQuote(jsonlPath),
  ].join(" ");

  const result = runShell(command, {
    cwd: trialDir,
    env,
    check: false,
    timeoutMs: 45 * 60 * 1000,
    maxBuffer: 200 * 1024 * 1024,
  });
  fs.writeFileSync(stderrPath, result.stderr || "");
  return result;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function runChecks(trialDir, benchDir, task, env, revision) {
  const checks = task.checks || [];
  const results = [];
  for (const [index, command] of checks.entries()) {
    const result = runShell(command, {
      cwd: trialDir,
      env,
      check: false,
      timeoutMs: 10 * 60 * 1000,
      logFile: path.join(benchDir, `check-${revision}-${index + 1}.log`),
    });
    results.push({
      command,
      status: result.status,
      timedOut: result.timedOut,
      log: `check-${revision}-${index + 1}.log`,
    });
  }
  return results;
}

function checkSummary(checks) {
  if (!checks.length) {
    return "";
  }
  return checks
    .map((check) => `${check.status === 0 ? "PASS" : "FAIL"} ${check.command} (status ${check.status})`)
    .join("\n");
}

function parseUsage(jsonlPath) {
  if (!fs.existsSync(jsonlPath)) {
    return emptyUsage();
  }

  const lines = fs.readFileSync(jsonlPath, "utf8").split("\n").filter(Boolean);
  let latest = null;
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.type === "event_msg" && event.payload?.type === "token_count") {
        latest = normalizeUsage(event.payload.info?.total_token_usage) || latest;
      } else if (event.type === "turn.completed" && event.usage) {
        latest = normalizeUsage(event.usage) || latest;
      }
    } catch {
      // Ignore non-JSON output in a JSONL log.
    }
  }
  return latest || emptyUsage();
}

function normalizeUsage(usage) {
  if (!usage) {
    return null;
  }
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  return {
    input_tokens: input,
    cached_input_tokens: usage.cached_input_tokens || usage.cache_read_tokens || 0,
    output_tokens: output,
    reasoning_output_tokens: usage.reasoning_output_tokens || 0,
    total_tokens: usage.total_tokens || input + output,
  };
}

function emptyUsage() {
  return {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
  };
}

function addUsage(a, b) {
  return {
    input_tokens: (a.input_tokens || 0) + (b.input_tokens || 0),
    cached_input_tokens: (a.cached_input_tokens || 0) + (b.cached_input_tokens || 0),
    output_tokens: (a.output_tokens || 0) + (b.output_tokens || 0),
    reasoning_output_tokens: (a.reasoning_output_tokens || 0) + (b.reasoning_output_tokens || 0),
    total_tokens: (a.total_tokens || 0) + (b.total_tokens || 0),
  };
}

// Marginal Entire-attributable cost proxy (separates fixed/marginal Entire
// overhead from total task cost). Total worker tokens conflate two things:
// the conventional source/git investigation the baseline also does, and the
// *extra* context the Entire arm pulls in (skill file + `entire` command
// output). This walks the worker JSONL and approximates the token volume the
// worker ingested from Entire-specific commands and skill-file reads, so a
// summary can show how much of an Entire arm's spend is Entire-attributable
// rather than shared task work.
//
// Heuristic and best-effort: codex `--json` event shapes vary by version, so we
// deep-scan every event for command-like fields paired with output-like fields
// and only count outputs whose command targets Entire. Returns 0 cleanly when
// nothing matches. Tokens are approximated at ~4 chars/token.
const ENTIRE_COMMAND_RE = /\bentire\b\s+(status|checkpoint|search|explain|trail)/i;
const ENTIRE_SKILL_RE = /using-entire|SKILL\.md|\.codex\/skills|\.entire\//i;
const COMMAND_KEYS = new Set(["command", "cmd", "input", "call", "arguments", "args"]);
const OUTPUT_KEYS = new Set(["output", "aggregated_output", "stdout", "result", "content", "text"]);

function approxTokens(chars) {
  return Math.ceil(chars / 4);
}

function asText(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// scanEntireEvidence inspects one parsed JSONL event object. If it looks like a
// command execution targeting Entire (or a read of an Entire/skill file), it
// returns the approximate output-token volume the worker ingested from it.
function scanEntireEvidence(node) {
  if (!node || typeof node !== "object") {
    return 0;
  }
  let commandText = "";
  let outputText = "";
  for (const [key, value] of Object.entries(node)) {
    const lower = key.toLowerCase();
    if (COMMAND_KEYS.has(lower)) {
      commandText += ` ${asText(value)}`;
    } else if (OUTPUT_KEYS.has(lower) && typeof value === "string") {
      outputText += value;
    }
  }
  let total = 0;
  if (commandText && (ENTIRE_COMMAND_RE.test(commandText) || ENTIRE_SKILL_RE.test(commandText))) {
    // Charge the output if present, else the command echo itself.
    total += approxTokens(outputText.length || commandText.length);
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") {
      total += scanEntireEvidence(value);
    }
  }
  return total;
}

function parseEntireMarginal(jsonlPath) {
  if (!fs.existsSync(jsonlPath)) {
    return 0;
  }
  const lines = fs.readFileSync(jsonlPath, "utf8").split("\n").filter(Boolean);
  let approxOutputTokens = 0;
  for (const line of lines) {
    try {
      approxOutputTokens += scanEntireEvidence(JSON.parse(line));
    } catch {
      // Ignore non-JSON lines.
    }
  }
  return approxOutputTokens;
}

function parseReviewerVerdict(lastMessagePath) {
  if (!fs.existsSync(lastMessagePath)) {
    return { verdict: "REVISE", feedback: "Reviewer produced no final message.", confidence: 0 };
  }
  const content = fs.readFileSync(lastMessagePath, "utf8").trim();
  const jsonText = extractJsonObject(content);
  if (!jsonText) {
    return {
      verdict: "REVISE",
      feedback: `Reviewer response was not parseable JSON: ${truncate(content, 1000)}`,
      confidence: 0,
    };
  }
  try {
    const parsed = JSON.parse(jsonText);
    const verdict = String(parsed.verdict || "REVISE").toUpperCase();
    return {
      verdict: ["PASS", "REVISE", "FAIL"].includes(verdict) ? verdict : "REVISE",
      feedback: String(parsed.feedback || ""),
      confidence: Number(parsed.confidence || 0),
    };
  } catch (error) {
    return {
      verdict: "REVISE",
      feedback: `Reviewer JSON parse failed: ${error.message}`,
      confidence: 0,
    };
  }
}

function extractJsonObject(content) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    return fenced[1].trim();
  }
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return "";
  }
  return content.slice(start, end + 1);
}

function gitDiff(trialDir) {
  return run("git", ["diff", "--", ".", ...ignoredPathspecs()], {
    cwd: trialDir,
    check: false,
  }).stdout;
}

function gitStatus(trialDir) {
  return run("git", ["status", "--short", "--untracked-files=all", "--", ".", ...ignoredPathspecs()], {
    cwd: trialDir,
    check: false,
  }).stdout;
}

function ignoredPathspecs() {
  return [
    ":(exclude).bench/**",
    ":(exclude).codex/**",
    ":(exclude).agents/**",
    ":(exclude).entire/**",
    ":(exclude)node_modules/**",
    ":(exclude)dist/**",
  ];
}

function runTrial({ task, mode, arm, rep, runDir, opts }) {
  const root = MODE_CONFIGS[mode].rootKind === "baseline" ? opts.baselineRoot : opts.entireRoot;
  const trialDir = path.join(runDir, task.id, `rep-${rep}`, arm);
  const branch = `bench/${slugPart(path.basename(runDir))}/${slugPart(task.id)}-r${rep}-${arm}`;

  console.log(`\n[trial] task=${task.id} rep=${rep} arm=${arm} mode=${mode}`);
  const prepared = prepareTrial(root, trialDir, task, mode, branch, opts.dryRun);
  if (opts.dryRun) {
    console.log(`[dry-run] worker model=${opts.workerModel}, reviewer model=${opts.reviewerModel}`);
    return {
      taskId: task.id,
      mode,
      arm,
      rep,
      trialDir,
      branch,
      dryRun: true,
    };
  }

  const benchDir = path.join(trialDir, ".bench");
  const trialMeta = {
    taskId: task.id,
    mode,
    arm,
    rep,
    trialDir,
    branch,
    base: task.base,
    workerModel: opts.workerModel,
    reviewerModel: opts.reviewerModel,
    startedAt: new Date().toISOString(),
    revisions: [],
  };
  fs.writeFileSync(path.join(benchDir, "trial-meta.json"), JSON.stringify(trialMeta, null, 2));

  const install = maybeInstallDependencies(trialDir, benchDir, task, prepared.env);
  trialMeta.installDependencies = install;

  let finalVerdict = { verdict: "REVISE", feedback: "No review completed.", confidence: 0 };
  let workerUsage = emptyUsage();
  let reviewerUsage = emptyUsage();
  let workerMarginalApproxTokens = 0;

  for (let revision = 0; revision <= opts.maxRevisions; revision += 1) {
    const feedbackPath = path.join(benchDir, "review-feedback.md");
    const workerPrompt = buildWorkerPrompt(task, mode, revision, feedbackPath);
    const workerPromptPath = path.join(benchDir, `worker-${revision}.prompt.md`);
    const workerJsonlPath = path.join(benchDir, `worker-${revision}.jsonl`);
    const workerLastPath = path.join(benchDir, `worker-${revision}.last.md`);
    fs.writeFileSync(workerPromptPath, workerPrompt);

    const workerResult = codexExec({
      trialDir,
      model: opts.workerModel,
      promptPath: workerPromptPath,
      jsonlPath: workerJsonlPath,
      lastMessagePath: workerLastPath,
      env: prepared.env,
      sandbox: "danger-full-access",
    });

    const checks = runChecks(trialDir, benchDir, task, prepared.env, revision);
    const diff = gitDiff(trialDir);
    const status = gitStatus(trialDir);
    fs.writeFileSync(path.join(benchDir, `diff-${revision}.patch`), diff);
    fs.writeFileSync(path.join(benchDir, `status-${revision}.txt`), status);

    const artifacts = {
      finalMessage: fs.existsSync(workerLastPath) ? fs.readFileSync(workerLastPath, "utf8") : "",
      diff,
      checkSummary: checkSummary(checks),
    };
    const reviewerPrompt = buildReviewerPrompt(task, artifacts);
    const reviewerPromptPath = path.join(benchDir, `reviewer-${revision}.prompt.md`);
    const reviewerJsonlPath = path.join(benchDir, `reviewer-${revision}.jsonl`);
    const reviewerLastPath = path.join(benchDir, `reviewer-${revision}.last.json`);
    fs.writeFileSync(reviewerPromptPath, reviewerPrompt);

    const reviewerResult = codexExec({
      trialDir,
      model: opts.reviewerModel,
      promptPath: reviewerPromptPath,
      jsonlPath: reviewerJsonlPath,
      lastMessagePath: reviewerLastPath,
      env: prepared.env,
      sandbox: "read-only",
    });

    const verdict = parseReviewerVerdict(reviewerLastPath);
    fs.writeFileSync(feedbackPath, verdict.feedback);

    const revisionRecord = {
      revision,
      workerStatus: workerResult.status,
      reviewerStatus: reviewerResult.status,
      checks,
      verdict,
      workerUsage: parseUsage(workerJsonlPath),
      reviewerUsage: parseUsage(reviewerJsonlPath),
      workerMarginalApproxTokens: parseEntireMarginal(workerJsonlPath),
    };
    trialMeta.revisions.push(revisionRecord);
    workerUsage = addUsage(workerUsage, revisionRecord.workerUsage);
    reviewerUsage = addUsage(reviewerUsage, revisionRecord.reviewerUsage);
    workerMarginalApproxTokens += revisionRecord.workerMarginalApproxTokens;
    finalVerdict = verdict;

    if (verdict.verdict === "PASS") {
      break;
    }
    if (verdict.verdict === "FAIL") {
      break;
    }
  }

  trialMeta.completedAt = new Date().toISOString();
  trialMeta.finalVerdict = finalVerdict;
  trialMeta.workerUsage = workerUsage;
  trialMeta.reviewerUsage = reviewerUsage;
  trialMeta.workerMarginalApproxTokens = workerMarginalApproxTokens;
  trialMeta.workerCostUsd = round4(costForUsage(workerUsage, opts.workerModel, opts.pricing));
  trialMeta.reviewerCostUsd = round4(costForUsage(reviewerUsage, opts.reviewerModel, opts.pricing));
  trialMeta.finalStatus = gitStatus(trialDir);
  trialMeta.finalDiffPath = ".bench/diff-final.patch";
  fs.writeFileSync(path.join(benchDir, "diff-final.patch"), gitDiff(trialDir));
  fs.writeFileSync(path.join(benchDir, "trial-meta.json"), JSON.stringify(trialMeta, null, 2));
  console.log(
    `[result] ${task.id} ${mode} ${finalVerdict.verdict} worker_tokens=${workerUsage.total_tokens} worker_cost=$${trialMeta.workerCostUsd} entire_marginal~=${workerMarginalApproxTokens}`,
  );

  return trialMeta;
}

// resolveContinuationBase rewrites a continuation task's `base` to the seed
// commit that "session A" produced, so both arms continue from identical code
// while only the Entire arm can read the checkpoint metadata of the prior work.
// Non-continuation tasks pass through untouched.
//
// Resolution order: explicit --seed-base wins; otherwise auto-seed via
// seedContinuation (skipped in dry-run). If neither yields a base, the task is
// skipped with a warning rather than breaking the whole run.
function resolveContinuationBase(task, opts, runMeta) {
  const isContinuation = task.kind === "continuation" || Boolean(task.seed);
  if (!isContinuation) {
    return task;
  }
  if (opts.seedBase) {
    console.log(`[seed] ${task.id}: using --seed-base ${opts.seedBase}`);
    return { ...task, base: opts.seedBase };
  }
  if (opts.dryRun) {
    console.log(`[dry-run] [seed] would seed continuation task ${task.id} from ${task.base}`);
    return task;
  }
  try {
    const sha = seedContinuation(task, opts);
    console.log(`[seed] ${task.id}: continuation base ${sha}`);
    runMeta.warnings.push(`Seeded continuation task ${task.id} at ${sha}`);
    return { ...task, base: sha };
  } catch (error) {
    const warning = `Skipping continuation task ${task.id}: seed failed (${error.message}). Provide --seed-base or run 'seed' first.`;
    console.warn(`[warning] ${warning}`);
    runMeta.warnings.push(warning);
    return null;
  }
}

// seedContinuation runs the "session A" partial-work phase for a continuation
// task inside the Entire-enabled root, commits it so the commit carries an
// Entire-Checkpoint trailer (git hooks attach it from the codex session that
// just ran), publishes the seed commit + checkpoint metadata to origin, and
// makes the commit available in the baseline root too. Returns the seed SHA.
//
// NOTE: requires `--execute`. This path cannot be validated without a live
// codex + Entire install; treat it as a scaffold and verify end-to-end before
// trusting continuation numbers.
function seedContinuation(task, opts) {
  if (!task.seed || !task.seed.prompt) {
    throw new Error(`continuation task ${task.id} needs a "seed" with a "prompt"`);
  }
  const seedDir = path.join(opts.runsRoot, "_seeds", slugPart(task.id));
  const branch = `bench-seed/${slugPart(task.id)}`;

  // Fresh worktree from the task base in the Entire-enabled root.
  run("git", ["worktree", "remove", "--force", seedDir], {
    cwd: opts.entireRoot,
    check: false,
  });
  fs.mkdirSync(path.dirname(seedDir), { recursive: true });
  run("git", ["worktree", "add", "-B", branch, seedDir, task.base], { cwd: opts.entireRoot });

  // Enable Entire and install git hooks so the seed commit gets a checkpoint
  // trailer, and register codex so its lifecycle hooks create checkpoints.
  run("entire", ["enable", "--force"], { cwd: seedDir, check: false });
  run("entire", ["agent", "add", "codex", "--force"], { cwd: seedDir, check: false });

  const benchDir = path.join(seedDir, ".bench");
  fs.mkdirSync(benchDir, { recursive: true });
  const seedTask = {
    ...task,
    prompt: task.seed.prompt,
    acceptanceCriteria: task.seed.acceptanceCriteria || task.acceptanceCriteria,
    checks: task.seed.checks || [],
    installDependencies: task.seed.installDependencies,
  };
  maybeInstallDependencies(seedDir, benchDir, seedTask, process.env);

  const promptPath = path.join(benchDir, "seed.prompt.md");
  fs.writeFileSync(promptPath, buildWorkerPrompt(seedTask, "entire", 0, ""));
  codexExec({
    trialDir: seedDir,
    model: opts.workerModel,
    promptPath,
    jsonlPath: path.join(benchDir, "seed.jsonl"),
    lastMessagePath: path.join(benchDir, "seed.last.md"),
    env: { ...process.env, BENCH_MODE: "seed" },
    sandbox: "danger-full-access",
  });
  runChecks(seedDir, benchDir, seedTask, process.env, 0);

  // Commit the partial work; the prepare-commit-msg hook attaches the
  // Entire-Checkpoint trailer for the codex session that just ran.
  run("git", ["add", "-A"], { cwd: seedDir });
  run("git", ["commit", "-m", `seed: partial work for ${task.id}`], {
    cwd: seedDir,
    check: false,
  });
  const sha = run("git", ["rev-parse", "HEAD"], { cwd: seedDir }).stdout.trim();

  // Publish the seed commit and checkpoint metadata so the baseline root can
  // start from the same code (without checkpoint access) and the Entire root
  // can read the prior session's checkpoints.
  run("git", ["push", "--force", "origin", `${branch}:${branch}`], { cwd: seedDir, check: false });
  run("git", ["push", "origin", "entire/checkpoints/v1:entire/checkpoints/v1"], {
    cwd: seedDir,
    check: false,
  });
  run("git", ["fetch", "origin", branch], { cwd: opts.baselineRoot, check: false });

  return sha;
}

function seedCommand(opts) {
  if (!opts.task) {
    throw new Error("seed requires --task <id>.");
  }
  const manifest = resolveFromRepo(opts.manifest);
  const [task] = readTasks(manifest, 1, { includeDrafts: true, task: opts.task });
  if (!task) {
    throw new Error(`No task with id "${opts.task}".`);
  }
  if (opts.dryRun) {
    console.log(`[dry-run] would seed ${task.id} from ${task.base} in ${opts.entireRoot}`);
    return;
  }
  const sha = seedContinuation(task, opts);
  console.log(`Seed commit for ${task.id}: ${sha}`);
  console.log(`Re-run with: --task ${task.id} --seed-base ${sha}`);
}

function runBenchmark(opts) {
  const manifest = resolveFromRepo(opts.manifest);
  const tasks = readTasks(manifest, opts.limit, {
    includeDrafts: opts.includeDrafts,
    task: opts.task,
  });
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}`;
  const runDir = path.join(opts.runsRoot, runId);
  const runMeta = {
    runId,
    runDir,
    startedAt: new Date().toISOString(),
    dryRun: opts.dryRun,
    workerModel: opts.workerModel,
    reviewerModel: opts.reviewerModel,
    pricing: opts.pricing,
    modes: opts.modes,
    replicates: opts.replicates,
    maxRevisions: opts.maxRevisions,
    tasks: tasks.map((task) => task.id),
    trials: [],
    warnings: [],
  };

  if (opts.workerModel === opts.reviewerModel) {
    const warning = "Worker and reviewer models are the same; cross-model review is weaker.";
    console.warn(`[warning] ${warning}`);
    runMeta.warnings.push(warning);
  }

  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "run-meta.json"), JSON.stringify(runMeta, null, 2));

  for (const task of tasks) {
    const resolvedTask = resolveContinuationBase(task, opts, runMeta);
    if (!resolvedTask) {
      continue;
    }
    for (let rep = 1; rep <= opts.replicates; rep += 1) {
      const modes = shuffle(opts.modes);
      modes.forEach((mode, index) => {
        const arm = `arm-${String.fromCharCode(97 + index)}`;
        const trial = runTrial({ task: resolvedTask, mode, arm, rep, runDir, opts });
        runMeta.trials.push({
          taskId: resolvedTask.id,
          rep,
          arm,
          mode,
          trialDir: trial.trialDir,
          branch: trial.branch,
          finalVerdict: trial.finalVerdict,
          workerUsage: trial.workerUsage,
          reviewerUsage: trial.reviewerUsage,
          workerMarginalApproxTokens: trial.workerMarginalApproxTokens,
          workerCostUsd: trial.workerCostUsd,
          reviewerCostUsd: trial.reviewerCostUsd,
        });
        fs.writeFileSync(path.join(runDir, "run-meta.json"), JSON.stringify(runMeta, null, 2));
      });
    }
  }

  runMeta.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(runDir, "run-meta.json"), JSON.stringify(runMeta, null, 2));

  if (!opts.dryRun) {
    summarize(runDir);
  } else {
    console.log(`\nDry run written to ${runDir}`);
  }
}

function geomean(ratios) {
  const valid = ratios.filter((r) => Number.isFinite(r) && r > 0);
  if (!valid.length) {
    return null;
  }
  const meanLog = valid.reduce((sum, r) => sum + Math.log(r), 0) / valid.length;
  return Math.exp(meanLog);
}

function median(values) {
  const valid = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!valid.length) {
    return null;
  }
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
}

function average(values) {
  const valid = values.filter((v) => Number.isFinite(v));
  if (!valid.length) {
    return 0;
  }
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

// pairedDeltasForMode pairs every (taskId, rep) trial of `mode` with the
// matching baseline trial and reports per-pair ratios. Ratios <1 mean the mode
// is cheaper than baseline (a saving). We aggregate with the geometric mean of
// per-pair ratios, NOT a summed-total percentage: a summed total is dominated
// by whichever single task happens to be the most expensive, which is exactly
// how the earlier headline flipped between runs.
function pairedDeltasForMode(trialMetas, mode) {
  const byKey = new Map();
  for (const trial of trialMetas) {
    const key = `${trial.taskId}::${trial.rep}`;
    const entry = byKey.get(key) || {};
    entry[trial.mode] = trial;
    byKey.set(key, entry);
  }

  const tokenRatios = [];
  const costRatios = [];
  const perTaskAgg = new Map();
  for (const [, entry] of byKey) {
    const base = entry.baseline;
    const cur = entry[mode];
    if (!base || !cur) {
      continue;
    }
    const baseTokens = base.workerUsage?.total_tokens || 0;
    const curTokens = cur.workerUsage?.total_tokens || 0;
    const baseCost = base.workerCostUsd || 0;
    const curCost = cur.workerCostUsd || 0;
    const tokenRatio = baseTokens > 0 ? curTokens / baseTokens : null;
    const costRatio = baseCost > 0 ? curCost / baseCost : null;
    if (tokenRatio) tokenRatios.push(tokenRatio);
    if (costRatio) costRatios.push(costRatio);

    const taskId = cur.taskId;
    const agg = perTaskAgg.get(taskId) || { baseTokens: [], curTokens: [], baseCost: [], curCost: [] };
    agg.baseTokens.push(baseTokens);
    agg.curTokens.push(curTokens);
    agg.baseCost.push(baseCost);
    agg.curCost.push(curCost);
    perTaskAgg.set(taskId, agg);
  }

  const perTask = [...perTaskAgg.entries()].map(([taskId, agg]) => ({
    taskId,
    baselineTokensAvg: Math.round(average(agg.baseTokens)),
    modeTokensAvg: Math.round(average(agg.curTokens)),
    baselineCostUsdAvg: round4(average(agg.baseCost)),
    modeCostUsdAvg: round4(average(agg.curCost)),
    costRatio: average(agg.baseCost) > 0 ? round4(average(agg.curCost) / average(agg.baseCost)) : null,
  }));

  const tokenGeo = geomean(tokenRatios);
  const costGeo = geomean(costRatios);
  return {
    mode,
    pairs: Math.min(tokenRatios.length, costRatios.length) || tokenRatios.length,
    tokenRatioGeomean: tokenGeo === null ? null : round4(tokenGeo),
    tokenRatioMedian: median(tokenRatios) === null ? null : round4(median(tokenRatios)),
    costRatioGeomean: costGeo === null ? null : round4(costGeo),
    costRatioMedian: median(costRatios) === null ? null : round4(median(costRatios)),
    // Positive savings% means the mode is cheaper than baseline on cost.
    costSavingsPctGeomean: costGeo === null ? null : round4((1 - costGeo) * 100),
    perTask,
  };
}

function summarize(runDir) {
  const metaPath = path.join(runDir, "run-meta.json");
  const runMeta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const pricing = runMeta.pricing || DEFAULT_PRICING;
  const workerModel = runMeta.workerModel;
  const reviewerModel = runMeta.reviewerModel;
  const trialMetas = [];

  for (const trial of runMeta.trials || []) {
    const trialMetaPath = path.join(trial.trialDir, ".bench", "trial-meta.json");
    if (fs.existsSync(trialMetaPath)) {
      const trialMeta = JSON.parse(fs.readFileSync(trialMetaPath, "utf8"));
      refreshTrialUsage(trialMeta, pricing, workerModel, reviewerModel);
      fs.writeFileSync(trialMetaPath, JSON.stringify(trialMeta, null, 2));
      trialMetas.push(trialMeta);
    }
  }

  const byMode = new Map();
  for (const trial of trialMetas) {
    const bucket =
      byMode.get(trial.mode) ||
      {
        mode: trial.mode,
        trials: 0,
        pass: 0,
        revise: 0,
        fail: 0,
        workerUsage: emptyUsage(),
        reviewerUsage: emptyUsage(),
        workerCostUsd: 0,
        reviewerCostUsd: 0,
        workerMarginalApproxTokens: 0,
      };
    bucket.trials += 1;
    const verdict = trial.finalVerdict?.verdict || "REVISE";
    if (verdict === "PASS") {
      bucket.pass += 1;
    } else if (verdict === "FAIL") {
      bucket.fail += 1;
    } else {
      bucket.revise += 1;
    }
    bucket.workerUsage = addUsage(bucket.workerUsage, trial.workerUsage || emptyUsage());
    bucket.reviewerUsage = addUsage(bucket.reviewerUsage, trial.reviewerUsage || emptyUsage());
    bucket.workerCostUsd = round4(bucket.workerCostUsd + (trial.workerCostUsd || 0));
    bucket.reviewerCostUsd = round4(bucket.reviewerCostUsd + (trial.reviewerCostUsd || 0));
    bucket.workerMarginalApproxTokens += trial.workerMarginalApproxTokens || 0;
    byMode.set(trial.mode, bucket);
  }

  const nonBaselineModes = [...byMode.keys()].filter((m) => m !== "baseline");
  const pairedDeltas = byMode.has("baseline")
    ? nonBaselineModes.map((mode) => pairedDeltasForMode(trialMetas, mode))
    : [];

  const summary = {
    runId: runMeta.runId,
    runDir,
    workerModel,
    reviewerModel,
    pricingNote:
      "Costs use --pricing (placeholder DEFAULT_PRICING if unset). Compare cost, not raw total_tokens.",
    modes: [...byMode.values()],
    pairedDeltas,
    trials: trialMetas.map((trial) => ({
      taskId: trial.taskId,
      mode: trial.mode,
      rep: trial.rep,
      verdict: trial.finalVerdict?.verdict,
      workerTokens: trial.workerUsage?.total_tokens || 0,
      workerCostUsd: trial.workerCostUsd || 0,
      workerMarginalApproxTokens: trial.workerMarginalApproxTokens || 0,
      reviewerTokens: trial.reviewerUsage?.total_tokens || 0,
      trialDir: trial.trialDir,
    })),
  };

  fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(runDir, "summary.md"), renderSummary(summary));
  console.log(renderSummary(summary));
}

function renderSummary(summary) {
  const lines = [
    `# Token Benchmark Summary`,
    "",
    `Run: ${summary.runId}`,
    `Worker model: ${summary.workerModel}`,
    `Reviewer model: ${summary.reviewerModel}`,
    "",
    `> ${summary.pricingNote}`,
    "",
    "## Modes",
    "",
  ];

  for (const mode of summary.modes) {
    const u = mode.workerUsage;
    const fresh = Math.max((u.input_tokens || 0) - (u.cached_input_tokens || 0), 0);
    lines.push(
      `- ${mode.mode}: trials=${mode.trials}, pass=${mode.pass}, revise=${mode.revise}, fail=${mode.fail}`,
    );
    lines.push(
      `  worker: cost=$${mode.workerCostUsd}, total_tokens=${u.total_tokens}, fresh_in=${fresh}, cached_in=${u.cached_input_tokens || 0}, out=${u.output_tokens || 0}, reasoning=${u.reasoning_output_tokens || 0}`,
    );
    lines.push(
      `  entire-attributable (marginal, approx): ~${mode.workerMarginalApproxTokens} tokens of skill/command output ingested`,
    );
    lines.push(`  reviewer: cost=$${mode.reviewerCostUsd}, total_tokens=${mode.reviewerUsage.total_tokens}`);
  }

  if (summary.pairedDeltas && summary.pairedDeltas.length) {
    lines.push("");
    lines.push("## Paired Cost Deltas vs baseline");
    lines.push("");
    lines.push(
      "Per-(task,rep) ratios aggregated by geometric mean. ratio<1 = cheaper than baseline; savings% positive = cheaper.",
    );
    lines.push("");
    for (const delta of summary.pairedDeltas) {
      lines.push(
        `- ${delta.mode}: pairs=${delta.pairs}, cost_ratio_geomean=${delta.costRatioGeomean}, cost_ratio_median=${delta.costRatioMedian}, cost_savings%=${delta.costSavingsPctGeomean}, token_ratio_geomean=${delta.tokenRatioGeomean}`,
      );
      for (const t of delta.perTask) {
        lines.push(
          `    - ${t.taskId}: baseline=$${t.baselineCostUsdAvg}, ${delta.mode}=$${t.modeCostUsdAvg}, cost_ratio=${t.costRatio} (tokens ${t.baselineTokensAvg} -> ${t.modeTokensAvg})`,
        );
      }
    }
  }

  lines.push("");
  lines.push("## Trials");
  lines.push("");
  for (const trial of summary.trials) {
    lines.push(
      `- ${trial.taskId} ${trial.mode} rep=${trial.rep}: verdict=${trial.verdict}, cost=$${trial.workerCostUsd}, worker_tokens=${trial.workerTokens}, entire_marginal~=${trial.workerMarginalApproxTokens}`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

// refreshTrialUsage recomputes usage/cost/marginal from the per-revision JSONL
// logs when they are present. Raw JSONL is intentionally gitignored, so when
// re-summarizing a run whose logs were already cleaned, it falls back to the
// values stored in trial-meta.json rather than zeroing the trial out.
function refreshTrialUsage(trialMeta, pricing = DEFAULT_PRICING, workerModel, reviewerModel) {
  const benchDir = path.join(trialMeta.trialDir, ".bench");
  let workerUsage = emptyUsage();
  let reviewerUsage = emptyUsage();
  let marginal = 0;
  for (const revision of trialMeta.revisions || []) {
    const index = revision.revision;
    const workerJsonl = path.join(benchDir, `worker-${index}.jsonl`);
    const reviewerJsonl = path.join(benchDir, `reviewer-${index}.jsonl`);
    revision.workerUsage = fs.existsSync(workerJsonl)
      ? parseUsage(workerJsonl)
      : revision.workerUsage || emptyUsage();
    revision.reviewerUsage = fs.existsSync(reviewerJsonl)
      ? parseUsage(reviewerJsonl)
      : revision.reviewerUsage || emptyUsage();
    revision.workerMarginalApproxTokens = fs.existsSync(workerJsonl)
      ? parseEntireMarginal(workerJsonl)
      : revision.workerMarginalApproxTokens || 0;
    workerUsage = addUsage(workerUsage, revision.workerUsage);
    reviewerUsage = addUsage(reviewerUsage, revision.reviewerUsage);
    marginal += revision.workerMarginalApproxTokens;
  }
  // No parseable per-revision data (e.g. logs cleaned and revisions empty):
  // keep whatever the trial already recorded.
  if (workerUsage.total_tokens > 0 || !trialMeta.workerUsage) {
    trialMeta.workerUsage = workerUsage;
  }
  if (reviewerUsage.total_tokens > 0 || !trialMeta.reviewerUsage) {
    trialMeta.reviewerUsage = reviewerUsage;
  }
  if (marginal > 0 || trialMeta.workerMarginalApproxTokens === undefined) {
    trialMeta.workerMarginalApproxTokens = marginal;
  }
  trialMeta.workerCostUsd = round4(
    costForUsage(trialMeta.workerUsage, workerModel || trialMeta.workerModel, pricing),
  );
  trialMeta.reviewerCostUsd = round4(
    costForUsage(trialMeta.reviewerUsage, reviewerModel || trialMeta.reviewerModel, pricing),
  );
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  opts.manifest = resolveFromRepo(opts.manifest);

  if (opts.command === "setup") {
    setup(opts);
    return;
  }
  if (opts.command === "seed") {
    seedCommand(opts);
    return;
  }
  if (opts.command === "run") {
    runBenchmark(opts);
    return;
  }
  if (opts.command === "summarize") {
    if (!opts.runDir) {
      throw new Error("--run-dir is required for summarize.");
    }
    summarize(opts.runDir);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
