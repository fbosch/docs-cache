import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Bench } from "tinybench";

import {
	cleanCache,
	enforceHostAllowlist,
	loadConfig,
	parseArgs,
	parseLsRemote,
	pruneCache,
	redactRepoUrl,
	resolveRepoInput,
	runSync,
	verifyCache,
} from "../../dist/api.mjs";
import {
	readLock,
	resolveLockPath,
	validateLock,
	writeLock,
} from "../../dist/lock.mjs";

const ITERATIONS = Number(process.env.BENCH_ITERATIONS ?? 50);
const FILE_COUNT = Number(process.env.BENCH_FILES ?? 200);
const WARMUP = Number(process.env.BENCH_WARMUP ?? 10);
const SYNC_ITERATIONS = Number(process.env.BENCH_SYNC_ITERATIONS ?? 10);
const CLI_ITERATIONS = Number(process.env.BENCH_CLI_ITERATIONS ?? 10);
const BENCH_GIT_REMOTE = process.env.BENCH_GIT_REMOTE === "1";
const BENCH_GIT_ITERATIONS = Number(process.env.BENCH_GIT_ITERATIONS ?? 1);
const BENCH_GIT_REPO =
	process.env.BENCH_GIT_REPO ?? "https://github.com/fbosch/dotfiles";
const BENCH_GIT_INCLUDE = (process.env.BENCH_GIT_INCLUDE ?? "README.md")
	.split(",")
	.map((entry) => entry.trim())
	.filter((entry) => entry.length > 0);

const execFileAsync = promisify(execFile);

const formatMs = (value) => `${value.toFixed(2)}ms`;

const createRepo = async (root, fileCount) => {
	const repoDir = path.join(root, "repo");
	await mkdir(repoDir, { recursive: true });
	for (let i = 0; i < fileCount; i += 1) {
		const section = String(i % 10).padStart(2, "0");
		const targetDir = path.join(repoDir, "docs", section);
		await mkdir(targetDir, { recursive: true });
		const targetFile = path.join(targetDir, `file-${i}.md`);
		await writeFile(targetFile, `content ${i}\n`, "utf8");
	}
	return repoDir;
};

const createConfigFile = async (root, repo, include) => {
	const configPath = path.join(root, "docs.config.json");
	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "bench",
				repo,
				include,
				maxBytes: 500000000,
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
	return configPath;
};

const runCli = async (args) => {
	await execFileAsync(process.execPath, ["dist/cli.mjs", ...args], {
		cwd: process.cwd(),
		maxBuffer: 1024 * 1024,
	});
};

const runGit = async (args, cwd) => {
	await execFileAsync("git", args, {
		cwd,
		maxBuffer: 1024 * 1024,
	});
};

const formatRow = (result) => {
	const min = result.min ?? 0;
	const max = result.max ?? 0;
	const avg = result.mean ?? result.avg ?? 0;
	const p95 = result.p95 ?? 0;
	return (
		`${result.name.padEnd(32)} ${formatMs(avg).padStart(10)} ` +
		`(p95 ${formatMs(p95).padStart(8)}, min ${formatMs(min).padStart(8)}, ` +
		`max ${formatMs(max).padStart(8)}, n=${result.runs ?? 0})`
	);
};

const summarizeBench = (bench) =>
	bench.tasks.map((task) => {
		const latency = task.result?.latency;
		return {
			name: task.name,
			runs: latency?.samplesCount ?? 0,
			mean: latency?.mean ?? 0,
			p95: latency?.p95 ?? 0,
			min: latency?.min ?? 0,
			max: latency?.max ?? 0,
		};
	});

const main = async () => {
	const root = path.join(
		tmpdir(),
		`docs-cache-bench-${Date.now().toString(36)}`,
	);
	await mkdir(root, { recursive: true });
	const benchRoot = root;
	try {
		const repoDir = await createRepo(benchRoot, FILE_COUNT);
		const configPath = await createConfigFile(
			benchRoot,
			"https://example.com/repo.git",
			["docs/**/*.md"],
		);
		const cacheDir = path.join(benchRoot, ".docs");

		const hotCacheDir = path.join(benchRoot, ".docs-hot");
		await runSync(
			{
				configPath,
				cacheDirOverride: hotCacheDir,
				json: true,
				lockOnly: false,
				offline: false,
				failOnMiss: false,
			},
			{
				resolveRemoteCommit: async () => ({
					repo: "https://example.com/repo.git",
					ref: "HEAD",
					resolvedCommit: "abc123",
				}),
				fetchSource: async () => ({
					repoDir,
					cleanup: async () => undefined,
				}),
			},
		);

		const lockPath = resolveLockPath(configPath);
		const lockData = await readLock(lockPath);

		const fastBench = new Bench({
			iterations: ITERATIONS,
			warmup: WARMUP,
		});
		fastBench.add("loadConfig", async () => {
			await loadConfig(configPath);
		});
		fastBench.add("parseArgs", () => {
			parseArgs([
				"node",
				"docs-cache",
				"sync",
				"--config",
				configPath,
				"--cache-dir",
				cacheDir,
				"--json",
				"--timeout-ms",
				"5000",
			]);
		});
		fastBench.add("resolveRepoInput", () => {
			resolveRepoInput("github:org/repo#main");
		});
		fastBench.add("enforceHostAllowlist", () => {
			enforceHostAllowlist("https://github.com/org/repo.git", [
				"github.com",
				"gitlab.com",
			]);
		});
		fastBench.add("parseLsRemote", () => {
			parseLsRemote("abc123\tHEAD\n");
		});
		fastBench.add("redactRepoUrl", () => {
			redactRepoUrl("https://token:secret@github.com/org/repo.git");
		});
		fastBench.add("validateLock", () => {
			validateLock(lockData);
		});
		fastBench.add("readLock", async () => {
			await readLock(lockPath);
		});
		fastBench.add("writeLock", async () => {
			const tempLock = path.join(
				benchRoot,
				`docs.lock.${Math.random().toString(36).slice(2)}`,
			);
			await writeLock(tempLock, lockData);
		});
		await fastBench.run();

		const ioBench = new Bench({
			iterations: ITERATIONS,
			warmup: WARMUP,
		});
		ioBench.add("verifyCache", async () => {
			await verifyCache({
				configPath,
				cacheDirOverride: hotCacheDir,
				json: true,
			});
		});
		ioBench.add("pruneCache", async () => {
			const extra = path.join(
				hotCacheDir,
				`unused-${Math.random().toString(36).slice(2)}`,
			);
			await mkdir(extra, { recursive: true });
			await pruneCache({
				configPath,
				cacheDirOverride: hotCacheDir,
				json: true,
			});
		});
		ioBench.add("cleanCache", async () => {
			const tempCache = path.join(benchRoot, `cleanup-${Date.now()}`);
			await runSync(
				{
					configPath,
					cacheDirOverride: tempCache,
					json: true,
					lockOnly: false,
					offline: false,
					failOnMiss: false,
				},
				{
					resolveRemoteCommit: async () => ({
						repo: "https://example.com/repo.git",
						ref: "HEAD",
						resolvedCommit: "abc123",
					}),
					fetchSource: async () => ({
						repoDir,
						cleanup: async () => undefined,
					}),
				},
			);
			await cleanCache({
				configPath,
				cacheDirOverride: tempCache,
				json: true,
			});
		});
		await ioBench.run();

		const syncBench = new Bench({
			iterations: SYNC_ITERATIONS,
			warmup: Math.min(WARMUP, 3),
		});
		let coldIteration = 0;
		syncBench.add("runSync (cold cache)", async () => {
			const cacheDirOverride = path.join(benchRoot, `.docs-${coldIteration}`);
			coldIteration += 1;
			await runSync(
				{
					configPath,
					cacheDirOverride,
					json: true,
					lockOnly: false,
					offline: false,
					failOnMiss: false,
				},
				{
					resolveRemoteCommit: async () => ({
						repo: "https://example.com/repo.git",
						ref: "HEAD",
						resolvedCommit: "abc123",
					}),
					fetchSource: async () => ({
						repoDir,
						cleanup: async () => undefined,
					}),
				},
			);
		});
		syncBench.add("runSync (hot cache)", async () => {
			await runSync(
				{
					configPath,
					cacheDirOverride: hotCacheDir,
					json: true,
					lockOnly: false,
					offline: false,
					failOnMiss: false,
				},
				{
					resolveRemoteCommit: async () => ({
						repo: "https://example.com/repo.git",
						ref: "HEAD",
						resolvedCommit: "abc123",
					}),
					fetchSource: async () => ({
						repoDir,
						cleanup: async () => undefined,
					}),
				},
			);
		});
		await syncBench.run();

		const cliBench = new Bench({
			iterations: CLI_ITERATIONS,
			warmup: Math.min(WARMUP, 3),
		});
		cliBench.add("cli --help", async () => {
			await runCli(["--help"]);
		});
		cliBench.add("cli status --json", async () => {
			await runCli([
				"status",
				"--json",
				"--config",
				configPath,
				"--cache-dir",
				hotCacheDir,
			]);
		});
		cliBench.add("cli verify --json", async () => {
			await runCli([
				"verify",
				"--json",
				"--config",
				configPath,
				"--cache-dir",
				hotCacheDir,
			]);
		});
		cliBench.add("cli sync --offline", async () => {
			await runCli([
				"sync",
				"--offline",
				"--json",
				"--config",
				configPath,
				"--cache-dir",
				hotCacheDir,
			]);
		});
		await cliBench.run();

		process.stdout.write("\nBenchmarks\n");
		process.stdout.write(
			`files=${FILE_COUNT} iterations=${ITERATIONS} sync=${SYNC_ITERATIONS} cli=${CLI_ITERATIONS}\n`,
		);
		process.stdout.write("\nfast\n");
		for (const result of summarizeBench(fastBench)) {
			process.stdout.write(`${formatRow(result)}\n`);
		}
		process.stdout.write("\nio\n");
		for (const result of summarizeBench(ioBench)) {
			process.stdout.write(`${formatRow(result)}\n`);
		}
		process.stdout.write("\nsync\n");
		for (const result of summarizeBench(syncBench)) {
			process.stdout.write(`${formatRow(result)}\n`);
		}
		process.stdout.write("\ncli\n");
		for (const result of summarizeBench(cliBench)) {
			process.stdout.write(`${formatRow(result)}\n`);
		}

		if (BENCH_GIT_REMOTE) {
			const remoteRoot = path.join(benchRoot, "remote");
			await mkdir(remoteRoot, { recursive: true });
			const remoteRuns = [
				{
					label: "runSync (remote git, sparse)",
					root: path.join(remoteRoot, "sparse"),
					include: BENCH_GIT_INCLUDE,
				},
				{
					label: "runSync (remote git, full)",
					root: path.join(remoteRoot, "full"),
					include: ["**/*"],
				},
			];
			process.stdout.write("\nremote\n");
			for (const run of remoteRuns) {
				await mkdir(run.root, { recursive: true });
				const remoteConfigPath = await createConfigFile(
					run.root,
					BENCH_GIT_REPO,
					run.include,
				);
				const remoteBench = new Bench({
					iterations: BENCH_GIT_ITERATIONS,
					warmup: 0,
				});
				let remoteIteration = 0;
				remoteBench.add(run.label, async () => {
					const cacheDirOverride = path.join(
						run.root,
						`.docs-${remoteIteration}`,
					);
					remoteIteration += 1;
					await runSync({
						configPath: remoteConfigPath,
						cacheDirOverride,
						json: true,
						lockOnly: false,
						offline: false,
						failOnMiss: false,
					});
				});
				await remoteBench.run();
				process.stdout.write(
					`repo=${BENCH_GIT_REPO} include=${run.include.join(",")} iterations=${BENCH_GIT_ITERATIONS}\n`,
				);
				for (const result of summarizeBench(remoteBench)) {
					process.stdout.write(`${formatRow(result)}\n`);
				}
			}
		}
	} finally {
		await rm(benchRoot, { recursive: true, force: true });
	}
};

await main();
