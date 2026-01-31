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
const LARGE_FILES_MB = Number(process.env.BENCH_LARGE_FILES_MB ?? 0);
const LARGE_FILES_COUNT = Number(process.env.BENCH_LARGE_FILES_COUNT ?? 0);

const execFileAsync = promisify(execFile);

const formatMs = (value) => `${value.toFixed(2)}ms`;
const formatBytes = (value) => {
	if (value < 1024) {
		return `${value} B`;
	}
	const units = ["KB", "MB", "GB", "TB"];
	let size = value;
	let index = -1;
	while (size >= 1024 && index < units.length - 1) {
		size /= 1024;
		index += 1;
	}
	return `${size.toFixed(2)} ${units[index]}`;
};

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
	if (LARGE_FILES_MB > 0 && LARGE_FILES_COUNT > 0) {
		const largeDir = path.join(repoDir, "large");
		await mkdir(largeDir, { recursive: true });
		const chunk = Buffer.alloc(1024 * 1024, "a");
		for (let i = 0; i < LARGE_FILES_COUNT; i += 1) {
			const filePath = path.join(largeDir, `blob-${i}.bin`);
			for (let mb = 0; mb < LARGE_FILES_MB; mb += 1) {
				await writeFile(filePath, chunk, { flag: mb === 0 ? "w" : "a" });
			}
		}
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

const createMemoryTracker = () => {
	const stats = new Map();
	const track = (label, before, after) => {
		const deltaRss = Math.max(0, after.rss - before.rss);
		const deltaHeap = Math.max(0, after.heapUsed - before.heapUsed);
		const entry = stats.get(label) ?? {
			count: 0,
			rss: { sum: 0, min: Infinity, max: 0 },
			heap: { sum: 0, min: Infinity, max: 0 },
		};
		entry.count += 1;
		entry.rss.sum += deltaRss;
		entry.rss.min = Math.min(entry.rss.min, deltaRss);
		entry.rss.max = Math.max(entry.rss.max, deltaRss);
		entry.heap.sum += deltaHeap;
		entry.heap.min = Math.min(entry.heap.min, deltaHeap);
		entry.heap.max = Math.max(entry.heap.max, deltaHeap);
		stats.set(label, entry);
	};
	return { stats, track };
};

const addBench = (bench, label, fn, memory) => {
	bench.add(label, async () => {
		const before = process.memoryUsage();
		await fn();
		const after = process.memoryUsage();
		memory.track(label, before, after);
	});
};

const formatMemoryRow = (label, entry) => {
	if (!entry || entry.count === 0) {
		return `${label.padEnd(32)} rss avg 0 B (min 0 B, max 0 B) heap avg 0 B (min 0 B, max 0 B)`;
	}
	const rssAvg = entry.rss.sum / entry.count;
	const heapAvg = entry.heap.sum / entry.count;
	return (
		`${label.padEnd(32)} ` +
		`rss avg ${formatBytes(rssAvg)} (min ${formatBytes(entry.rss.min)}, max ${formatBytes(entry.rss.max)}) ` +
		`heap avg ${formatBytes(heapAvg)} (min ${formatBytes(entry.heap.min)}, max ${formatBytes(entry.heap.max)})`
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
		const localInclude = ["docs/**/*.md"];
		if (LARGE_FILES_MB > 0 && LARGE_FILES_COUNT > 0) {
			localInclude.push("large/**/*.bin");
		}
		const configPath = await createConfigFile(
			benchRoot,
			"https://example.com/repo.git",
			localInclude,
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

		const fastMemory = createMemoryTracker();
		const fastBench = new Bench({
			iterations: ITERATIONS,
			warmup: WARMUP,
		});
		addBench(fastBench, "loadConfig", () => loadConfig(configPath), fastMemory);
		addBench(
			fastBench,
			"parseArgs",
			() =>
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
				]),
			fastMemory,
		);
		addBench(
			fastBench,
			"resolveRepoInput",
			() => resolveRepoInput("github:org/repo#main"),
			fastMemory,
		);
		addBench(
			fastBench,
			"enforceHostAllowlist",
			() =>
				enforceHostAllowlist("https://github.com/org/repo.git", [
					"github.com",
					"gitlab.com",
				]),
			fastMemory,
		);
		addBench(
			fastBench,
			"parseLsRemote",
			() => parseLsRemote("abc123\tHEAD\n"),
			fastMemory,
		);
		addBench(
			fastBench,
			"redactRepoUrl",
			() => redactRepoUrl("https://token:secret@github.com/org/repo.git"),
			fastMemory,
		);
		addBench(
			fastBench,
			"validateLock",
			() => validateLock(lockData),
			fastMemory,
		);
		addBench(fastBench, "readLock", () => readLock(lockPath), fastMemory);
		addBench(
			fastBench,
			"writeLock",
			() => {
				const tempLock = path.join(
					benchRoot,
					`docs.lock.${Math.random().toString(36).slice(2)}`,
				);
				return writeLock(tempLock, lockData);
			},
			fastMemory,
		);
		await fastBench.run();

		const ioMemory = createMemoryTracker();
		const ioBench = new Bench({
			iterations: ITERATIONS,
			warmup: WARMUP,
		});
		addBench(
			ioBench,
			"verifyCache",
			() =>
				verifyCache({
					configPath,
					cacheDirOverride: hotCacheDir,
					json: true,
				}),
			ioMemory,
		);
		addBench(
			ioBench,
			"pruneCache",
			async () => {
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
			},
			ioMemory,
		);
		addBench(
			ioBench,
			"cleanCache",
			async () => {
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
			},
			ioMemory,
		);
		await ioBench.run();

		const syncMemory = createMemoryTracker();
		const syncBench = new Bench({
			iterations: SYNC_ITERATIONS,
			warmup: Math.min(WARMUP, 3),
		});
		let coldIteration = 0;
		addBench(
			syncBench,
			"runSync (cold cache)",
			() => {
				const cacheDirOverride = path.join(benchRoot, `.docs-${coldIteration}`);
				coldIteration += 1;
				return runSync(
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
			},
			syncMemory,
		);
		addBench(
			syncBench,
			"runSync (hot cache)",
			() =>
				runSync(
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
				),
			syncMemory,
		);
		await syncBench.run();

		const cliMemory = createMemoryTracker();
		const cliBench = new Bench({
			iterations: CLI_ITERATIONS,
			warmup: Math.min(WARMUP, 3),
		});
		addBench(cliBench, "cli --help", () => runCli(["--help"]), cliMemory);
		addBench(
			cliBench,
			"cli status --json",
			() =>
				runCli([
					"status",
					"--json",
					"--config",
					configPath,
					"--cache-dir",
					hotCacheDir,
				]),
			cliMemory,
		);
		addBench(
			cliBench,
			"cli verify --json",
			() =>
				runCli([
					"verify",
					"--json",
					"--config",
					configPath,
					"--cache-dir",
					hotCacheDir,
				]),
			cliMemory,
		);
		addBench(
			cliBench,
			"cli sync --offline",
			() =>
				runCli([
					"sync",
					"--offline",
					"--json",
					"--config",
					configPath,
					"--cache-dir",
					hotCacheDir,
				]),
			cliMemory,
		);
		await cliBench.run();

		process.stdout.write("\nBenchmarks\n");
		process.stdout.write(
			`files=${FILE_COUNT} iterations=${ITERATIONS} sync=${SYNC_ITERATIONS} cli=${CLI_ITERATIONS}\n`,
		);
		const printGroup = (label, bench, memory) => {
			process.stdout.write(`\n${label}\n`);
			for (const result of summarizeBench(bench)) {
				process.stdout.write(`${formatRow(result)}\n`);
			}
			process.stdout.write(`${label} memory\n`);
			for (const result of summarizeBench(bench)) {
				const entry = memory.stats.get(result.name);
				process.stdout.write(`${formatMemoryRow(result.name, entry)}\n`);
			}
		};

		printGroup("fast", fastBench, fastMemory);
		printGroup("io", ioBench, ioMemory);
		printGroup("sync", syncBench, syncMemory);
		printGroup("cli", cliBench, cliMemory);

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
				const remoteMemory = createMemoryTracker();
				const remoteBench = new Bench({
					iterations: BENCH_GIT_ITERATIONS,
					warmup: 0,
				});
				let remoteIteration = 0;
				addBench(
					remoteBench,
					run.label,
					() => {
						const cacheDirOverride = path.join(
							run.root,
							`.docs-${remoteIteration}`,
						);
						remoteIteration += 1;
						return runSync({
							configPath: remoteConfigPath,
							cacheDirOverride,
							json: true,
							lockOnly: false,
							offline: false,
							failOnMiss: false,
						});
					},
					remoteMemory,
				);
				await remoteBench.run();
				process.stdout.write(
					`repo=${BENCH_GIT_REPO} include=${run.include.join(",")} iterations=${BENCH_GIT_ITERATIONS}\n`,
				);
				for (const result of summarizeBench(remoteBench)) {
					process.stdout.write(`${formatRow(result)}\n`);
				}
				process.stdout.write("remote memory\n");
				for (const result of summarizeBench(remoteBench)) {
					const entry = remoteMemory.stats.get(result.name);
					process.stdout.write(`${formatMemoryRow(result.name, entry)}\n`);
				}
			}
		}
	} finally {
		await rm(benchRoot, { recursive: true, force: true });
	}
};

await main();
