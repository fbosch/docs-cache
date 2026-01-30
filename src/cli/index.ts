import path from "node:path";
import process from "node:process";
import pc from "picocolors";
import { addSources } from "../add";
import { redactRepoUrl } from "../git/redact";
import { getStatus, printStatus } from "../status";
import { printSyncPlan, runSync } from "../sync";
import { ExitCode } from "./exit-code";
import { parseArgs } from "./parse-args";
import { symbols } from "./symbols";
import type { CliOptions } from "./types";

export const CLI_NAME = "docs-cache";

const HELP_TEXT = `
Usage: ${CLI_NAME} <command> [options]

Commands:
  add     Add sources to the config (supports github:org/repo#ref)
  sync    Synchronize cache with config
  status  Show cache status
  clean   Remove cache
  prune   Remove unused data
  verify  Validate cache integrity

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
				process.stdout.write(
					`${symbols.success} Added ${pc.cyan(source.id)} ${pc.dim("(")}${pc.blue(repoLabel)}${pc.dim(")")}${targetLabel}\n`,
				);
			}
			if (result.skipped?.length) {
				process.stdout.write(
					`${symbols.warn} Skipped ${pc.cyan(String(result.skipped.length))} existing source${result.skipped.length === 1 ? "" : "s"}: ${result.skipped.join(", ")}\n`,
				);
			}
			process.stdout.write(
				`${symbols.info} Updated ${pc.gray(path.relative(process.cwd(), result.configPath) || "docs.config.json")}\n`,
			);
		}
		return;
	}
	if (command === "status") {
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
	if (command === "sync") {
		const plan = await runSync({
			configPath: options.config,
			cacheDirOverride: options.cacheDir,
			json: options.json,
			lockOnly: options.lockOnly,
			timeoutMs: options.timeoutMs,
		});
		if (options.json) {
			process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
		} else {
			printSyncPlan(plan);
		}
		return;
	}
	process.stdout.write(`${CLI_NAME} ${command}: not implemented yet.\n`);
};

/**
 * The main entry point of the CLI
 */
export async function main(): Promise<void> {
	try {
		process.on("uncaughtException", errorHandler);
		process.on("unhandledRejection", errorHandler);

		const parsed = parseArgs();
		const rawArgs = parsed.rawArgs;

		if (parsed.help) {
			printHelp();
			process.exit(ExitCode.Success);
		}

		if (!parsed.command) {
			printHelp();
			process.exit(ExitCode.InvalidArgument);
		}

		if (parsed.command !== "add" && parsed.positionals.length > 0) {
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

export { parseArgs } from "./parse-args";
export { redactRepoUrl };

function errorHandler(error: Error): void {
	const message = error.message || String(error);
	printError(message);
	process.exit(ExitCode.FatalError);
}
