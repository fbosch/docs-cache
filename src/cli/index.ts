import process from "node:process";

import { addSource } from "../add";
import { getStatus, printStatus } from "../status";
import { ExitCode } from "./exit-code";
import { parseArgs } from "./parse-args";
import type { CliOptions } from "./types";

export const CLI_NAME = "docs-cache";

const HELP_TEXT = `
Usage: ${CLI_NAME} <command> [options]

Commands:
  add     Add a source to the config (supports github:org/repo#ref)
  sync    Synchronize cache with config
  status  Show cache status
  clean   Remove cache
  prune   Remove unused data
  verify  Validate cache integrity

Global options:
  --config <path>
  --cache-dir <path>
  --offline
  --fail-on-miss
  --concurrency <n>
  --json
  --timeout-ms <n>
`;

const printHelp = () => {
	process.stdout.write(HELP_TEXT.trimStart());
};

const runCommand = async (
	command: string,
	options: CliOptions,
	positionals: string[],
) => {
	if (command === "add") {
		const [first, second] = positionals;
		if (!first) {
			throw new Error("Usage: docs-cache add [id] <repo>");
		}
		const hasExplicitId = Boolean(second);
		const id = hasExplicitId ? first : "";
		const repo = hasExplicitId ? second : first;
		const result = await addSource({
			configPath: options.config,
			id,
			repo,
		});
		if (options.json) {
			process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		} else {
			process.stdout.write(
				`Added ${result.sourceId} -> ${result.sourceRepo} in ${result.configPath}\n`,
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

		if (parsed.help) {
			printHelp();
			process.exit(ExitCode.Success);
		}

		if (!parsed.command) {
			printHelp();
			process.exit(ExitCode.InvalidArgument);
		}

		if (parsed.command !== "add" && parsed.positionals.length > 0) {
			process.stderr.write(`${CLI_NAME}: unexpected arguments.\n`);
			printHelp();
			process.exit(ExitCode.InvalidArgument);
		}

		await runCommand(parsed.command, parsed.options, parsed.positionals);
	} catch (error) {
		errorHandler(error as Error);
	}
}

export { parseArgs } from "./parse-args";

function errorHandler(error: Error): void {
	const message = error.message || String(error);
	console.error(message);
	process.exit(ExitCode.FatalError);
}
