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
};

const usage = `Usage:
  node scripts/token-benchmark.mjs setup [options]
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

  if (!command || !["setup", "run", "summarize"].includes(command)) {
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

  return opts;
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

function readTasks(manifestPath, limit) {
  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error("Task manifest must be a JSON array.");
  }
  return parsed.slice(0, limit);
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

  if (mode === "baseline") {
    run("entire", ["disable", "--force"], {
      cwd: trialDir,
      check: false,
    });
    const shimDir = createEntireShim(trialDir);
    return {
      env: {
        ...process.env,
        PATH: `${shimDir}${path.delimiter}${process.env.PATH}`,
        BENCH_MODE: "baseline",
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
      BENCH_MODE: "entire",
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
  const modeInstructions =
    mode === "entire"
      ? [
          "You are in the Entire-assisted arm of a benchmark.",
          "Use Entire CLI strategically when it helps reduce rediscovery. Start with `entire status`.",
          "For historical questions, start from local checkpoint metadata: run `entire checkpoint explain --json --limit 100`, filter the JSON/messages for relevant checkpoint IDs, then inspect targeted IDs with `entire checkpoint explain <id> --json --no-pager`.",
          "Use `entire checkpoint search --json` only as an optional secondary source. If repo-scoped search returns empty or times out, record that briefly and continue with local checkpoint, code, and git evidence.",
        ]
      : [
          "You are in the baseline arm of a benchmark.",
          "Do not use Entire CLI, Entire checkpoint history, or `entire` commands. Use normal source inspection, git history, tests, and reasoning.",
        ];

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
  const root = mode === "baseline" ? opts.baselineRoot : opts.entireRoot;
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
    };
    trialMeta.revisions.push(revisionRecord);
    workerUsage = addUsage(workerUsage, revisionRecord.workerUsage);
    reviewerUsage = addUsage(reviewerUsage, revisionRecord.reviewerUsage);
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
  trialMeta.finalStatus = gitStatus(trialDir);
  trialMeta.finalDiffPath = ".bench/diff-final.patch";
  fs.writeFileSync(path.join(benchDir, "diff-final.patch"), gitDiff(trialDir));
  fs.writeFileSync(path.join(benchDir, "trial-meta.json"), JSON.stringify(trialMeta, null, 2));
  console.log(
    `[result] ${task.id} ${mode} ${finalVerdict.verdict} worker_tokens=${workerUsage.total_tokens} reviewer_tokens=${reviewerUsage.total_tokens}`,
  );

  return trialMeta;
}

function runBenchmark(opts) {
  const manifest = resolveFromRepo(opts.manifest);
  const tasks = readTasks(manifest, opts.limit);
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}`;
  const runDir = path.join(opts.runsRoot, runId);
  const runMeta = {
    runId,
    runDir,
    startedAt: new Date().toISOString(),
    dryRun: opts.dryRun,
    workerModel: opts.workerModel,
    reviewerModel: opts.reviewerModel,
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
    for (let rep = 1; rep <= opts.replicates; rep += 1) {
      const modes = shuffle(["baseline", "entire"]);
      modes.forEach((mode, index) => {
        const arm = `arm-${String.fromCharCode(97 + index)}`;
        const trial = runTrial({ task, mode, arm, rep, runDir, opts });
        runMeta.trials.push({
          taskId: task.id,
          rep,
          arm,
          mode,
          trialDir: trial.trialDir,
          branch: trial.branch,
          finalVerdict: trial.finalVerdict,
          workerUsage: trial.workerUsage,
          reviewerUsage: trial.reviewerUsage,
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

function summarize(runDir) {
  const metaPath = path.join(runDir, "run-meta.json");
  const runMeta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const trialMetas = [];

  for (const trial of runMeta.trials || []) {
    const trialMetaPath = path.join(trial.trialDir, ".bench", "trial-meta.json");
    if (fs.existsSync(trialMetaPath)) {
      const trialMeta = JSON.parse(fs.readFileSync(trialMetaPath, "utf8"));
      refreshTrialUsage(trialMeta);
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
    byMode.set(trial.mode, bucket);
  }

  const summary = {
    runId: runMeta.runId,
    runDir,
    workerModel: runMeta.workerModel,
    reviewerModel: runMeta.reviewerModel,
    modes: [...byMode.values()],
    trials: trialMetas.map((trial) => ({
      taskId: trial.taskId,
      mode: trial.mode,
      rep: trial.rep,
      verdict: trial.finalVerdict?.verdict,
      workerTokens: trial.workerUsage?.total_tokens || 0,
      reviewerTokens: trial.reviewerUsage?.total_tokens || 0,
      trialDir: trial.trialDir,
    })),
  };

  const baseline = byMode.get("baseline");
  const entire = byMode.get("entire");
  if (baseline && entire && baseline.workerUsage.total_tokens > 0) {
    summary.workerTokenDelta = {
      baselineTokens: baseline.workerUsage.total_tokens,
      entireTokens: entire.workerUsage.total_tokens,
      savingsTokens: baseline.workerUsage.total_tokens - entire.workerUsage.total_tokens,
      savingsPct:
        (baseline.workerUsage.total_tokens - entire.workerUsage.total_tokens) /
        baseline.workerUsage.total_tokens,
    };
  }

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
    "## Modes",
    "",
  ];

  for (const mode of summary.modes) {
    lines.push(
      `- ${mode.mode}: trials=${mode.trials}, pass=${mode.pass}, revise=${mode.revise}, fail=${mode.fail}, worker_tokens=${mode.workerUsage.total_tokens}, reviewer_tokens=${mode.reviewerUsage.total_tokens}`,
    );
  }

  if (summary.workerTokenDelta) {
    lines.push("");
    lines.push("## Worker Token Delta");
    lines.push("");
    lines.push(`- baseline worker tokens: ${summary.workerTokenDelta.baselineTokens}`);
    lines.push(`- entire worker tokens: ${summary.workerTokenDelta.entireTokens}`);
    lines.push(`- savings tokens: ${summary.workerTokenDelta.savingsTokens}`);
    lines.push(`- savings pct: ${(summary.workerTokenDelta.savingsPct * 100).toFixed(2)}%`);
  }

  lines.push("");
  lines.push("## Trials");
  lines.push("");
  for (const trial of summary.trials) {
    lines.push(
      `- ${trial.taskId} ${trial.mode} rep=${trial.rep}: verdict=${trial.verdict}, worker_tokens=${trial.workerTokens}, reviewer_tokens=${trial.reviewerTokens}`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

function refreshTrialUsage(trialMeta) {
  const benchDir = path.join(trialMeta.trialDir, ".bench");
  let workerUsage = emptyUsage();
  let reviewerUsage = emptyUsage();
  for (const revision of trialMeta.revisions || []) {
    const index = revision.revision;
    revision.workerUsage = parseUsage(path.join(benchDir, `worker-${index}.jsonl`));
    revision.reviewerUsage = parseUsage(path.join(benchDir, `reviewer-${index}.jsonl`));
    workerUsage = addUsage(workerUsage, revision.workerUsage);
    reviewerUsage = addUsage(reviewerUsage, revision.reviewerUsage);
  }
  trialMeta.workerUsage = workerUsage;
  trialMeta.reviewerUsage = reviewerUsage;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  opts.manifest = resolveFromRepo(opts.manifest);

  if (opts.command === "setup") {
    setup(opts);
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
