import process from "node:process";

import cac from "cac";
import { ExitCode } from "./exit-code";
import type { CliOptions } from "./types";

const COMMANDS = [
	"add",
	"remove",
	"sync",
	"status",
	"clean",
	"clean-cache",
	"prune",
	"verify",
	"init",
] as const;
type Command = (typeof COMMANDS)[number];

export type ParsedArgs = {
	command: Command | null;
	options: CliOptions;
	positionals: string[];
	rawArgs: string[];
	help: boolean;
};

export const parseArgs = (argv = process.argv): ParsedArgs => {
	try {
		const cli = cac("docs-cache");

		cli
			.option("--source <repo>", "Source repo (add only)")
			.option("--target <dir>", "Target directory for source (add only)")
			.option("--config <path>", "Path to config file")
			.option("--cache-dir <path>", "Override cache directory")
			.option("--offline", "Disable network access")
			.option("--fail-on-miss", "Fail when required sources are missing")
			.option("--lock-only", "Update lock without materializing files")
			.option("--prune", "Prune cache on remove")
			.option("--target-dir <path>", "Target directory for add")
			.option("--concurrency <n>", "Concurrency limit")
			.option("--json", "Output JSON")
			.option("--timeout-ms <n>", "Network timeout in milliseconds")
			.option("--silent", "Suppress non-error output")
			.help();

		const result = cli.parse(argv, { run: false });
		const command = result.args[0] as Command | undefined;
		if (command && !COMMANDS.includes(command)) {
			throw new Error(`Unknown command '${command}'.`);
		}

		const options: CliOptions = {
			config: result.options.config,
			cacheDir: result.options.cacheDir,
			offline: Boolean(result.options.offline),
			failOnMiss: Boolean(result.options.failOnMiss),
			lockOnly: Boolean(result.options.lockOnly),
			prune: Boolean(result.options.prune),
			targetDir: result.options.targetDir,
			concurrency: result.options.concurrency
				? Number(result.options.concurrency)
				: undefined,
			json: Boolean(result.options.json),
			timeoutMs: result.options.timeoutMs
				? Number(result.options.timeoutMs)
				: undefined,
			silent: Boolean(result.options.silent),
		};

		if (options.concurrency !== undefined && options.concurrency < 1) {
			throw new Error("--concurrency must be a positive number.");
		}
		if (options.timeoutMs !== undefined && options.timeoutMs < 1) {
			throw new Error("--timeout-ms must be a positive number.");
		}

		const rawArgs = argv.slice(2);
		return {
			command: command ?? null,
			options,
			positionals: result.args.slice(1),
			rawArgs,
			help: Boolean(result.options.help),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(message);
		process.exit(ExitCode.InvalidArgument);
	}
};
