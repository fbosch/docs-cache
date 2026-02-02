import path from "node:path";
import process from "node:process";
import pc from "picocolors";
import { ExitCode } from "./exit-code";
import { parseArgs } from "./parse-args";
import type { CliOptions } from "./types";
import { setSilentMode, symbols, ui } from "./ui";

export const CLI_NAME = "docs-cache";

const HELP_TEXT = `
Usage: ${CLI_NAME} <command> [options]

Commands:
  add     Add sources to the config (supports github:org/repo#ref)
  remove  Remove sources from the config and targets
  sync    Synchronize cache with config
  status  Show cache status
  clean   Remove cache
  prune   Remove unused data
  verify  Validate cache integrity
  init    Create a new config interactively

Global options:
  --source <repo> (add only)
  --target <dir> (add only)
  --config <path>
  --cache-dir <path>
  --offline
  --fail-on-miss
  --lock-only
  --target-dir <path> (add only)
  --concurrency <n>
  --json
  --timeout-ms <n>
  --silent
`;

const printHelp = () => {
	process.stdout.write(HELP_TEXT.trimStart());
};

const printError = (message: string) => {
	process.stderr.write(`${symbols.error} ${message}\n`);
};

const parseAddEntries = (rawArgs: string[]) => {
	const commandIndex = rawArgs.findIndex((arg) => !arg.startsWith("-"));
	const tail = commandIndex === -1 ? [] : rawArgs.slice(commandIndex + 1);
	const entries: Array<{ repo: string; targetDir?: string }> = [];
	let lastIndex = -1;
	const skipNextFor = new Set([
		"--config",
		"--cache-dir",
		"--concurrency",
		"--timeout-ms",
	]);
	for (let index = 0; index < tail.length; index += 1) {
		const arg = tail[index];
		if (arg === "--source") {
			const next = tail[index + 1];
			if (!next || next.startsWith("-")) {
				throw new Error("--source expects a value.");
			}
			entries.push({ repo: next });
			lastIndex = entries.length - 1;
			index += 1;
			continue;
		}
		if (arg === "--target" || arg === "--target-dir") {
			const next = tail[index + 1];
			if (!next || next.startsWith("-")) {
				throw new Error("--target expects a value.");
			}
			if (lastIndex === -1) {
				throw new Error("--target must follow a --source entry.");
			}
			entries[lastIndex].targetDir = next;
			index += 1;
			continue;
		}
		if (skipNextFor.has(arg)) {
			index += 1;
			continue;
		}
		if (arg.startsWith("--")) {
			continue;
		}
		entries.push({ repo: arg });
		lastIndex = entries.length - 1;
	}
	return entries;
};

const runCommand = async (
	command: string,
	options: CliOptions,
	positionals: string[],
	rawArgs: string[],
) => {
	if (command === "add") {
		const { addSources } = await import("../add");
		const { runSync } = await import("../sync");
		const entries = parseAddEntries(rawArgs);
		if (entries.length === 0) {
			throw new Error(
				"Usage: docs-cache add [--source <repo> --target <dir>] <repo...>",
			);
		}
		const result = await addSources({
			configPath: options.config,
			entries,
		});
		if (!options.offline) {
			await runSync({
				configPath: options.config,
				cacheDirOverride: options.cacheDir,
				json: options.json,
				lockOnly: options.lockOnly,
				offline: options.offline,
				failOnMiss: options.failOnMiss,
				sourceFilter: result.sources.map((source) => source.id),
				timeoutMs: options.timeoutMs,
			});
		} else if (!options.json) {
			ui.line(`${symbols.warn} Offline: skipped sync`);
		}
		if (options.json) {
			process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		} else {
			for (const source of result.sources) {
				const repoLabel = source.repo
					.replace(/^https?:\/\//, "")
					.replace(/\.git$/, "");
				const targetLabel = source.targetDir
					? ` ${pc.dim("->")} ${pc.magenta(source.targetDir)}`
					: "";
				ui.item(
					symbols.success,
					source.id,
					`${pc.blue(repoLabel)}${targetLabel}`,
				);
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
		}
		return;
	}
	if (command === "remove") {
		const { removeSources } = await import("../remove");
		const { pruneCache } = await import("../prune");
		if (positionals.length === 0) {
			throw new Error("Usage: docs-cache remove <id...>");
		}
		const result = await removeSources({
			configPath: options.config,
			ids: positionals,
		});
		if (options.json) {
			process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		} else {
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
		}
		if (options.prune) {
			await pruneCache({
				configPath: options.config,
				cacheDirOverride: options.cacheDir,
				json: options.json,
			});
		}
		return;
	}
	if (command === "status") {
		const { getStatus, printStatus } = await import("../status");
		const status = await getStatus({
			configPath: options.config,
			cacheDirOverride: options.cacheDir,
			json: options.json,
		});
		if (options.json) {
			process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
		} else {
			printStatus(status);
		}
		return;
	}
	if (command === "clean") {
		const { cleanCache } = await import("../clean");
		const result = await cleanCache({
			configPath: options.config,
			cacheDirOverride: options.cacheDir,
			json: options.json,
		});
		if (options.json) {
			process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		} else if (result.removed) {
			ui.line(
				`${symbols.success} Removed cache at ${ui.path(result.cacheDir)}`,
			);
		} else {
			ui.line(
				`${symbols.info} Cache already missing at ${ui.path(result.cacheDir)}`,
			);
		}
		return;
	}
	if (command === "prune") {
		const { pruneCache } = await import("../prune");
		const result = await pruneCache({
			configPath: options.config,
			cacheDirOverride: options.cacheDir,
			json: options.json,
		});
		if (options.json) {
			process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		} else if (result.removed.length === 0) {
			ui.line(`${symbols.info} No cache entries to prune.`);
		} else {
			ui.line(
				`${symbols.success} Pruned ${result.removed.length} cache entr${result.removed.length === 1 ? "y" : "ies"}: ${result.removed.join(", ")}`,
			);
		}
		return;
	}
	if (command === "sync") {
		const { printSyncPlan, runSync } = await import("../sync");
		const plan = await runSync({
			configPath: options.config,
			cacheDirOverride: options.cacheDir,
			json: options.json,
			lockOnly: options.lockOnly,
			offline: options.offline,
			failOnMiss: options.failOnMiss,
			timeoutMs: options.timeoutMs,
		});
		if (options.json) {
			process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
		} else {
			printSyncPlan(plan);
		}
		return;
	}
	if (command === "verify") {
		const { printVerify, verifyCache } = await import("../verify");
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
		return;
	}
	if (command === "init") {
		const { initConfig } = await import("../init");
		if (options.config) {
			throw new Error("Init does not accept --config. Use the project root.");
		}
		const result = await initConfig({
			cacheDirOverride: options.cacheDir,
			json: options.json,
		});
		if (options.json) {
			process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		} else {
			ui.line(
				`${symbols.success} Wrote ${pc.gray(ui.path(result.configPath))}`,
			);
			if (result.gitignoreUpdated && result.gitignorePath) {
				ui.line(
					`${symbols.info} Updated ${pc.gray(ui.path(result.gitignorePath))}`,
				);
			}
		}
		return;
	}
	ui.line(`${CLI_NAME} ${command}: not implemented yet.`);
};

/**
 * The main entry point of the CLI
 */
export async function main(): Promise<void> {
	try {
		process.on("uncaughtException", errorHandler);
		process.on("unhandledRejection", errorHandler);

		const parsed = parseArgs();
		const _rawArgs = parsed.rawArgs;

		// Set silent mode if the flag is present
		setSilentMode(parsed.options.silent);

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

		if (parsed.command !== "add" && parsed.options.targetDir) {
			printError(`${CLI_NAME}: --target-dir is only valid for add.`);
			printHelp();
			process.exit(ExitCode.InvalidArgument);
		}

		await runCommand(
			parsed.command,
			parsed.options,
			parsed.positionals,
			parsed.rawArgs,
		);
	} catch (error) {
		errorHandler(error as Error);
	}
}

function errorHandler(error: Error): void {
	const message = error.message || String(error);
	printError(message);
	process.exit(ExitCode.FatalError);
}
