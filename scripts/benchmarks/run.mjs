import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Bench } from "tinybench";

import { loadConfig, runSync } from "../../dist/api.mjs";

const ITERATIONS = Number(process.env.BENCH_ITERATIONS ?? 50);
const FILE_COUNT = Number(process.env.BENCH_FILES ?? 200);
const WARMUP = Number(process.env.BENCH_WARMUP ?? 10);

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

const createConfigFile = async (root) => {
	const configPath = path.join(root, "docs.config.json");
	const config = {
		$schema:
			"https://raw.githubusercontent.com/fbosch/docs-cache/main/docs.config.schema.json",
		sources: [
			{
				id: "bench",
				repo: "https://example.com/repo.git",
				include: ["docs/**/*.md"],
				maxBytes: 500000000,
			},
		],
	};
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
	return configPath;
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
		const configPath = await createConfigFile(benchRoot);

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

		const bench = new Bench({
			iterations: ITERATIONS,
			warmup: WARMUP,
		});

		bench.add("loadConfig", async () => {
			await loadConfig(configPath);
		});

		let coldIteration = 0;
		bench.add("runSync (cold cache)", async () => {
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

		bench.add("runSync (hot cache)", async () => {
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

		await bench.run();
		const results = summarizeBench(bench);
		process.stdout.write("\nBenchmarks\n");
		process.stdout.write(`files=${FILE_COUNT} iterations=${ITERATIONS}\n`);
		for (const result of results) {
			process.stdout.write(`${formatRow(result)}\n`);
		}
	} finally {
		await rm(benchRoot, { recursive: true, force: true });
	}
};

await main();
