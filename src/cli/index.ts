import path from "node:path";
import process from "node:process";
import pc from "picocolors";
import { ExitCode } from "#cli/exit-code";
import { parseArgs } from "#cli/parse-args";
import type { CliCommand } from "#cli/types";
import { setSilentMode, setVerboseMode, symbols, ui } from "#cli/ui";

export const CLI_NAME = "docs-cache";

const HELP_TEXT = `
Usage: ${CLI_NAME} <command> [options]

Commands:
  add         Add sources to the config (supports github:org/repo#ref)
  remove      Remove sources from the config and targets
  sync        Synchronize cache with config
  status      Show cache status
  clean       Remove project cache
  clean-cache Clear global git cache
  prune       Remove unused data
  verify      Validate cache integrity
  init        Create a new config interactively

Global options:
  --config <path>
  --cache-dir <path>
  --offline
  --fail-on-miss
  --lock-only
  --concurrency <n>
  --json
  --timeout-ms <n>
  --silent
  --verbose

Add options:
  --source <repo>
  --target <dir>
  --target-dir <path>
  --id <id>
`;

const printHelp = () => {
	process.stdout.write(HELP_TEXT.trimStart());
};

const printError = (message: string) => {
	process.stderr.write(`${symbols.error} ${message}\n`);
};

const runAdd = async (parsed: Extract<CliCommand, { command: "add" }>) => {
	const options = parsed.options;
	const { addSources } = await import("#commands/add");
	const { runSync } = await import("#commands/sync");
	if (parsed.entries.length === 0) {
		throw new Error(
			"Usage: docs-cache add [--source <repo> --target <dir>] <repo...>",
		);
	}
	const result = await addSources({
		configPath: options.config,
		entries: parsed.entries,
	});
	if (options.offline) {
		if (!options.json) {
			ui.line(`${symbols.warn} Offline: skipped sync`);
		}
	} else {
		await runSync({
			configPath: options.config,
			cacheDirOverride: options.cacheDir,
			json: options.json,
			lockOnly: options.lockOnly,
			offline: options.offline,
			failOnMiss: options.failOnMiss,
			sourceFilter: result.sources.map((source) => source.id),
			timeoutMs: options.timeoutMs,
			verbose: options.verbose,
		});
	}
	if (options.json) {
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}
	for (const source of result.sources) {
		const repoLabel = source.repo
			.replace(/^https?:\/\//, "")
			.replace(/\.git$/, "");
		const targetLabel = source.targetDir
			? ` ${pc.dim("->")} ${pc.magenta(source.targetDir)}`
			: "";
		ui.item(symbols.success, source.id, `${pc.blue(repoLabel)}${targetLabel}`);
	}
	if (result.skipped?.length) {
		ui.line(
			`${symbols.warn} Skipped ${result.skipped.length} existing source${result.skipped.length === 1 ? "" : "s"}: ${result.skipped.join(", ")}`,
		);
	}
	ui.line(
		`${symbols.info} Updated ${pc.gray(path.relative(process.cwd(), result.configPath) || "docs.config.json")}`,
	);
	if (result.gitignoreUpdated && result.gitignorePath) {
		ui.line(
			`${symbols.info} Updated ${pc.gray(ui.path(result.gitignorePath))}`,
		);
	}
};

const runRemove = async (
	parsed: Extract<CliCommand, { command: "remove" }>,
) => {
	const options = parsed.options;
	const { removeSources } = await import("#commands/remove");
	const { pruneCache } = await import("#commands/prune");
	if (parsed.ids.length === 0) {
		throw new Error("Usage: docs-cache remove <id...>");
	}
	const result = await removeSources({
		configPath: options.config,
		ids: parsed.ids,
	});
	if (options.json) {
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}
	if (result.removed.length > 0) {
		ui.line(
			`${symbols.success} Removed ${result.removed.length} source${result.removed.length === 1 ? "" : "s"}: ${result.removed.join(", ")}`,
		);
	}
	if (result.missing.length > 0) {
		ui.line(
			`${symbols.warn} Missing ${result.missing.length} source${result.missing.length === 1 ? "" : "s"}: ${result.missing.join(", ")}`,
		);
	}
	if (result.targetsRemoved.length > 0) {
		const targetLabels = result.targetsRemoved
			.map((entry) => `${entry.id} -> ${ui.path(entry.targetDir)}`)
			.join(", ");
		ui.line(
			`${symbols.success} Removed ${result.targetsRemoved.length} target${result.targetsRemoved.length === 1 ? "" : "s"}: ${targetLabels}`,
		);
	}
	ui.line(
		`${symbols.info} Updated ${pc.gray(path.relative(process.cwd(), result.configPath) || "docs.config.json")}`,
	);
	if (options.prune) {
		await pruneCache({
			configPath: options.config,
			cacheDirOverride: options.cacheDir,
			json: options.json,
		});
	}
};

const runStatus = async (
	parsed: Extract<CliCommand, { command: "status" }>,
) => {
	const options = parsed.options;
	const { getStatus, printStatus } = await import("#commands/status");
	const status = await getStatus({
		configPath: options.config,
		cacheDirOverride: options.cacheDir,
		json: options.json,
	});
	if (options.json) {
		process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
		return;
	}
	printStatus(status);
};

const runClean = async (parsed: Extract<CliCommand, { command: "clean" }>) => {
	const options = parsed.options;
	const { cleanCache } = await import("#commands/clean");
	const result = await cleanCache({
		configPath: options.config,
		cacheDirOverride: options.cacheDir,
		json: options.json,
	});
	if (options.json) {
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}
	if (result.removed) {
		ui.line(`${symbols.success} Removed cache at ${ui.path(result.cacheDir)}`);
		return;
	}
	ui.line(
		`${symbols.info} Cache already missing at ${ui.path(result.cacheDir)}`,
	);
};

const runCleanCache = async (
	parsed: Extract<CliCommand, { command: "clean-cache" }>,
) => {
	const options = parsed.options;
	const { cleanGitCache } = await import("#commands/clean-git-cache");
	const result = await cleanGitCache();
	if (options.json) {
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}
	if (!result.removed) {
		ui.line(
			`${symbols.info} Global git cache already empty at ${ui.path(result.cacheDir)}`,
		);
		return;
	}
	const sizeInMB =
		result.bytesFreed !== undefined
			? `${(result.bytesFreed / 1024 / 1024).toFixed(2)} MB`
			: "unknown size";
	const repoLabel =
		result.repoCount !== undefined
			? ` (${result.repoCount} cached repositor${result.repoCount === 1 ? "y" : "ies"})`
			: "";
	ui.line(
		`${symbols.success} Cleared global git cache${repoLabel}: ${sizeInMB} freed`,
	);
	ui.line(`${symbols.info} Cache location: ${ui.path(result.cacheDir)}`);
};

const runPrune = async (parsed: Extract<CliCommand, { command: "prune" }>) => {
	const options = parsed.options;
	const { pruneCache } = await import("#commands/prune");
	const result = await pruneCache({
		configPath: options.config,
		cacheDirOverride: options.cacheDir,
		json: options.json,
	});
	if (options.json) {
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}
	if (result.removed.length === 0) {
		ui.line(`${symbols.info} No cache entries to prune.`);
		return;
	}
	ui.line(
		`${symbols.success} Pruned ${result.removed.length} cache entr${result.removed.length === 1 ? "y" : "ies"}: ${result.removed.join(", ")}`,
	);
};

const runSyncCommand = async (
	parsed: Extract<CliCommand, { command: "sync" }>,
) => {
	const options = parsed.options;
	const { printSyncPlan, runSync } = await import("#commands/sync");
	const plan = await runSync({
		configPath: options.config,
		cacheDirOverride: options.cacheDir,
		json: options.json,
		lockOnly: options.lockOnly,
		offline: options.offline,
		failOnMiss: options.failOnMiss,
		timeoutMs: options.timeoutMs,
		verbose: options.verbose,
	});
	if (options.json) {
		process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
		return;
	}
	printSyncPlan(plan);
};

const runVerify = async (
	parsed: Extract<CliCommand, { command: "verify" }>,
) => {
	const options = parsed.options;
	const { printVerify, verifyCache } = await import("#commands/verify");
	const report = await verifyCache({
		configPath: options.config,
		cacheDirOverride: options.cacheDir,
		json: options.json,
	});
	if (options.json) {
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	} else {
		printVerify(report);
	}
	if (report.results.some((result) => !result.ok)) {
		process.exit(ExitCode.FatalError);
	}
};

const runInit = async (parsed: Extract<CliCommand, { command: "init" }>) => {
	const options = parsed.options;
	const { initConfig } = await import("#commands/init");
	if (options.config) {
		throw new Error("Init does not accept --config. Use the project root.");
	}
	const result = await initConfig({
		cacheDirOverride: options.cacheDir,
		json: options.json,
	});
	if (options.json) {
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}
	ui.line(`${symbols.success} Wrote ${pc.gray(ui.path(result.configPath))}`);
	if (result.gitignoreUpdated && result.gitignorePath) {
		ui.line(
			`${symbols.info} Updated ${pc.gray(ui.path(result.gitignorePath))}`,
		);
	}
};

const runCommand = async (parsed: CliCommand) => {
	switch (parsed.command) {
		case "add":
			await runAdd(parsed);
			return;
		case "remove":
			await runRemove(parsed);
			return;
		case "status":
			await runStatus(parsed);
			return;
		case "clean":
			await runClean(parsed);
			return;
		case "clean-cache":
			await runCleanCache(parsed);
			return;
		case "prune":
			await runPrune(parsed);
			return;
		case "sync":
			await runSyncCommand(parsed);
			return;
		case "verify":
			await runVerify(parsed);
			return;
		case "init":
			await runInit(parsed);
			return;
		default:
			ui.line(`${CLI_NAME} ${parsed.command}: not implemented yet.`);
	}
};

/**
 * The main entry point of the CLI
 */
export async function main(): Promise<void> {
	try {
		process.on("uncaughtException", errorHandler);
		process.on("unhandledRejection", errorHandler);

		const parsed = parseArgs();

		// Set silent mode if the flag is present
		setSilentMode(parsed.options.silent);
		setVerboseMode(parsed.options.verbose);

		if (parsed.help) {
			printHelp();
			process.exit(ExitCode.Success);
		}

		if (!parsed.command) {
			printHelp();
			process.exit(ExitCode.InvalidArgument);
		}

		if (
			parsed.command !== "add" &&
			parsed.command !== "remove" &&
			parsed.positionals.length > 0
		) {
			printError(`${CLI_NAME}: unexpected arguments.`);
			printHelp();
			process.exit(ExitCode.InvalidArgument);
		}

		await runCommand(parsed.parsed);
	} catch (error) {
		errorHandler(error);
	}
}

function errorHandler(error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	printError(message);
	process.exit(ExitCode.FatalError);
}
